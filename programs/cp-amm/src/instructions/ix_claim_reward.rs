use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    constants::NUM_REWARDS,
    error::PoolError,
    event::EvtClaimReward,
    state::{pool::Pool, position::Position, PositionDelegatePermission},
    token::transfer_from_pool,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimRewardCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        mut,
        has_one = pool,
    )]
    pub position: AccountLoader<'info, Position>,

    /// The vault token account for reward token
    #[account(mut, token::token_program = token_program, token::mint = reward_mint)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // Reward mint
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The token account for nft
    #[account(
            constraint = position_nft_account.mint == position.load()?.nft_mint,
            constraint = position_nft_account.amount == 1,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Signer
    pub signer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ClaimRewardCtx<'info> {
    fn validate(&self, reward_index: usize) -> Result<()> {
        let pool = self.pool.load()?;
        require!(reward_index < NUM_REWARDS, PoolError::InvalidRewardIndex);

        let reward_info = &pool.reward_infos[reward_index];
        require!(reward_info.initialized(), PoolError::RewardUninitialized);
        require!(
            reward_info.vault.eq(&self.reward_vault.key()),
            PoolError::InvalidRewardVault
        );

        Ok(())
    }
}

pub fn handle_claim_reward(
    ctx: Context<ClaimRewardCtx>,
    reward_index: u8,
    skip_reward: u8,
) -> Result<()> {
    let index: usize = reward_index
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;
    ctx.accounts.validate(index)?;

    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut position = ctx.accounts.position.load_mut()?;

    if ctx.accounts.reward_vault.is_frozen() && skip_reward == 1 {
        // this clears the pending reward without transferring it,
        // so only the unrestricted `ClaimReward` permission is allowed to perform it
        position.assert_authority(
            &ctx.accounts.position_nft_account,
            &ctx.accounts.signer.key(),
            PositionDelegatePermission::ClaimReward,
        )?;
    } else {
        position.assert_authority_with_owner_destinations(
            &ctx.accounts.position_nft_account,
            &ctx.accounts.signer.key(),
            PositionDelegatePermission::ClaimReward,
            PositionDelegatePermission::ClaimRewardToOwner,
            &[(
                &ctx.accounts.user_token_account.to_account_info(),
                ctx.accounts.reward_mint.key(),
                ctx.accounts.token_program.key(),
            )],
        )?;
    }

    let current_time = Clock::get()?.unix_timestamp as u64;

    // update pool reward & position reward
    position.update_rewards(&mut pool, current_time)?;

    // get all pending reward
    let total_reward = position.claim_reward(index)?;

    // transfer rewards to user
    if total_reward > 0 {
        if ctx.accounts.reward_vault.is_frozen() {
            require!(skip_reward == 1, PoolError::RewardVaultFrozenSkipRequired)
        } else {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.reward_mint,
                &ctx.accounts.reward_vault,
                &ctx.accounts.user_token_account.to_account_info(),
                &ctx.accounts.token_program,
                total_reward,
            )?;
        }
    }

    emit_cpi!(EvtClaimReward {
        pool: ctx.accounts.pool.key(),
        position: ctx.accounts.position.key(),
        mint_reward: ctx.accounts.reward_mint.key(),
        owner: ctx.accounts.position_nft_account.owner,
        reward_index,
        total_reward,
    });

    Ok(())
}
