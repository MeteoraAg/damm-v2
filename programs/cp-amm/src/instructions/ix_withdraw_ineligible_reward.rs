use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda, constants::NUM_REWARDS, error::PoolError, event::EvtWithdrawIneligibleReward,
    state::pool::Pool, token::transfer_from_pool,
};

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawIneligibleRewardCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub funder_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub funder: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> WithdrawIneligibleRewardCtx<'info> {
    fn validate(&self, reward_index: usize) -> Result<()> {
        let pool = self.pool.load()?;
        require!(reward_index < NUM_REWARDS, PoolError::InvalidRewardIndex);

        let reward_info = &pool.reward_infos[reward_index];

        require!(reward_info.initialized(), PoolError::RewardUninitialized);

        require!(
            reward_info.vault.eq(&self.reward_vault.key()),
            PoolError::InvalidRewardVault
        );

        require!(
            reward_info.is_valid_funder(self.funder.key()),
            PoolError::InvalidFunder
        );

        let current_timestamp = Clock::get()?.unix_timestamp as u64;
        require!(
            current_timestamp > reward_info.reward_duration_end,
            PoolError::RewardNotEnded
        );

        Ok(())
    }
}

pub fn handle_withdraw_ineligible_reward(
    ctx: Context<WithdrawIneligibleRewardCtx>,
    reward_index: u8,
) -> Result<()> {
    let index: usize = reward_index
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;
    ctx.accounts.validate(index)?;

    let mut pool = ctx.accounts.pool.load_mut()?;

    let current_time = Clock::get()?.unix_timestamp as u64;

    // update pool reward
    pool.update_rewards(current_time)?;

    let ineligible_reward = pool.claim_ineligible_reward(index)?;

    // transfer rewards to funder
    if ineligible_reward > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.reward_mint,
            &ctx.accounts.reward_vault,
            &ctx.accounts.funder_token_account,
            &ctx.accounts.token_program,
            ineligible_reward,
        )?;
    }

    emit_cpi!(EvtWithdrawIneligibleReward {
        amount: ineligible_reward,
        pool: ctx.accounts.pool.key(),
        reward_mint: ctx.accounts.reward_mint.key(),
    });

    Ok(())
}
