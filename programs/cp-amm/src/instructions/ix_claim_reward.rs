use crate::{
    constants::{ seeds::POOL_AUTHORITY_PREFIX, NUM_REWARDS },
    error::PoolError,
    event::EvtClaimReward,
    state::{
        authorize_modify_position,
        pool::Pool,
        position::Position,
        PositionLiquidityFlowValidator,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{ Mint, TokenAccount, TokenInterface, TransferChecked };

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    /// CHECK: pool authority
    #[account(seeds = [POOL_AUTHORITY_PREFIX.as_ref()], bump)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = pool,
        constraint = authorize_modify_position(&position, sender.key())?
    )]
    pub position: AccountLoader<'info, Position>,

    pub sender: Signer<'info>,

    #[account(mut)]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut)]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> ClaimReward<'info> {
    fn validate(&self, reward_index: usize) -> Result<()> {
        let pool = self.pool.load()?;
        require!(reward_index < NUM_REWARDS, PoolError::InvalidRewardIndex);

        let reward_info = &pool.reward_infos[reward_index];
        require!(reward_info.initialized(), PoolError::RewardUninitialized);
        require!(reward_info.vault.eq(&self.reward_vault.key()), PoolError::InvalidRewardVault);

        Ok(())
    }

    fn transfer_from_reward_vault_to_user(
        &self,
        amount: u64,
        pool_authority_bump: u8
    ) -> Result<()> {
        let signer_seeds = pool_authority_seeds!(pool_authority_bump);
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.reward_vault.to_account_info(),
                    to: self.user_token_account.to_account_info(),
                    authority: self.pool.to_account_info(),
                    mint: self.reward_mint.to_account_info(),
                },
                &[&signer_seeds[..]]
            ),
            amount,
            self.reward_mint.decimals
        )
    }
}

impl<'a, 'b, 'c, 'info> PositionLiquidityFlowValidator for ClaimReward<'info> {
    fn validate_outflow_to_ata_of_position_owner(&self, owner: Pubkey) -> Result<()> {
        let dest_reward_token = anchor_spl::associated_token::get_associated_token_address(
            &owner,
            &self.reward_mint.key()
        );
        require!(
            dest_reward_token == self.user_token_account.key() &&
                self.user_token_account.owner == owner,
            PoolError::WithdrawToWrongTokenAccount
        );

        Ok(())
    }
}

// TODO: Should we pass in range of bin we are going to collect reward ? It could help us in heap / compute unit issue by chunking into multiple tx.
pub fn handle_claim_reward(ctx: Context<ClaimReward>, index: u64) -> Result<()> {
    let reward_index: usize = index.try_into().map_err(|_| PoolError::TypeCastFailed)?;
    ctx.accounts.validate(reward_index)?;

    let mut position = ctx.accounts.position.load_mut()?;

    // if claim reward is not from owner then need to validate destination token address
    if position.owner != ctx.accounts.sender.key() {
        ctx.accounts.validate_outflow_to_ata_of_position_owner(position.owner)?;
    }

    let mut pool = ctx.accounts.pool.load_mut()?;
    let current_time = Clock::get()?.unix_timestamp;
    pool.update_rewards(current_time as u64)?;

    position.update_earning_per_token_stored(&pool)?;

    // get all pending reward
    let total_reward = position.get_total_reward(reward_index)?;

    position.accumulate_total_claimed_rewards(reward_index, total_reward);

    // set all pending rewards to zero
    position.reset_all_pending_reward(reward_index);
    position.set_last_updated_at(current_time);

    // Avoid pool immutable borrow error later when CPI due to RefMut borrow
    drop(pool);

    // transfer rewards to user
    if total_reward > 0 {
        let pool_authority_bump = *ctx.bumps.get("pool_authority").unwrap();
        ctx.accounts.transfer_from_reward_vault_to_user(total_reward, pool_authority_bump)?;
    }

    emit_cpi!(EvtClaimReward {
        pool: ctx.accounts.pool.key(),
        position: ctx.accounts.position.key(),
        owner: position.owner,
        reward_index: index,
        total_reward,
    });

    Ok(())
}
