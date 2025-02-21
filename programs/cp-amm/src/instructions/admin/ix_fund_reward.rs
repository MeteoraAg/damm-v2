use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::{NUM_REWARDS, SCALE_OFFSET},
    event::EvtFundReward,
    math::safe_math::SafeMath,
    state::Pool,
    token::{calculate_transfer_fee_included_amount, transfer_from_user},
    utils_math::safe_mul_shr_cast,
    PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct FundRewardCtx<'info> {
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

impl<'info> FundRewardCtx<'info> {
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
            PoolError::InvalidAdmin
        );

        Ok(())
    }
}

pub fn handle_fund_reward(
    ctx: Context<FundRewardCtx>,
    reward_index: u8,
    amount: u64,
    carry_forward: bool,
) -> Result<()> {
    let index: usize = reward_index
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;
    ctx.accounts.validate(index)?;

    let mut pool = ctx.accounts.pool.load_mut()?;
    let current_time = Clock::get()?.unix_timestamp;
    // 1. update pool rewards
    pool.update_rewards(current_time as u64)?;

    // 2. set new farming rate
    let reward_info = &mut pool.reward_infos[index];

    let total_amount = if carry_forward {
        let carry_forward_ineligible_reward: u64 = safe_mul_shr_cast(
            reward_info.reward_rate,
            reward_info
                .cumulative_seconds_with_empty_liquidity_reward
                .into(),
            SCALE_OFFSET,
        )?;

        // Reset cumulative seconds with empty liquidity reward
        // because it will be brought forward to next reward window
        reward_info.cumulative_seconds_with_empty_liquidity_reward = 0;

        amount.safe_add(carry_forward_ineligible_reward)?
    } else {
        // Because the program only keep track of cumulative seconds of rewards with empty liquidity,
        // and funding will affect the reward rate, which directly affect ineligible reward calculation.
        // ineligible_reward = reward_rate_per_seconds * cumulative_seconds_with_empty_liquidity_reward
        require!(
            reward_info.cumulative_seconds_with_empty_liquidity_reward == 0,
            PoolError::MustWithdrawnIneligibleReward
        );

        amount
    };

    // Reward rate might include ineligible reward based on whether to brought forward
    reward_info.update_rate_after_funding(current_time as u64, total_amount)?;
    // actual amount need to transfer
    let total_amount_include_fee =
        calculate_transfer_fee_included_amount(&ctx.accounts.reward_mint, total_amount)?.amount;

    if total_amount_include_fee > 0 {
        // Transfer without ineligible reward because it's already in the vault
        transfer_from_user(
            &ctx.accounts.funder,
            &ctx.accounts.reward_mint,
            &ctx.accounts.funder_token_account,
            &ctx.accounts.reward_vault,
            &ctx.accounts.token_program,
            total_amount_include_fee,
        )?;
    }

    emit_cpi!(EvtFundReward {
        pool: ctx.accounts.pool.key(),
        funder: ctx.accounts.funder.key(),
        mint_reward: ctx.accounts.reward_mint.key(),
        reward_index,
        amount: total_amount,
    });

    Ok(())
}
