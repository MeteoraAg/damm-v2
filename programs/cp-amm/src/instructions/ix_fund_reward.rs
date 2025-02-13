use crate::constants::NUM_REWARDS;
use crate::error::PoolError;
use crate::event::EvtFundReward;
use crate::state::Pool;
use crate::math::safe_math::SafeMath;
use crate::math::u64x64_math::SCALE_OFFSET;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{ Mint, TokenAccount, TokenInterface, TransferChecked };
use ruint::aliases::U256;

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u64)]
pub struct FundReward<'info> {
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

impl<'info> FundReward<'info> {
    fn validate(&self, reward_index: usize) -> Result<()> {
        let pool = self.pool.load()?;

        require!(reward_index < NUM_REWARDS, PoolError::InvalidRewardIndex);

        let reward_info = &pool.reward_infos[reward_index];
        require!(reward_info.initialized(), PoolError::RewardUninitialized);
        require!(reward_info.vault.eq(&self.reward_vault.key()), PoolError::InvalidRewardVault);
        require!(reward_info.is_valid_funder(self.funder.key()), PoolError::InvalidAdmin);

        Ok(())
    }

    fn transfer_from_funder_to_vault(&self, amount: u64) -> Result<()> {
        anchor_spl::token_2022::transfer_checked(
            CpiContext::new(self.token_program.to_account_info(), TransferChecked {
                from: self.funder_token_account.to_account_info(),
                to: self.reward_vault.to_account_info(),
                authority: self.funder.to_account_info(),
                mint: self.reward_mint.to_account_info(),
            }),
            amount,
            self.reward_mint.decimals
        )
    }
}

pub fn handle_fund_reward(
    ctx: Context<FundReward>,
    index: u64,
    amount: u64,
    carry_forward: bool
) -> Result<()> {
    let reward_index: usize = index.try_into().map_err(|_| PoolError::TypeCastFailed)?;
    ctx.accounts.validate(reward_index)?;

    let mut pool = ctx.accounts.pool.load_mut()?;
    let current_time = Clock::get()?.unix_timestamp;
    // 1. update rewards
    pool.update_rewards(current_time as u64)?;

    // 2. set new farming rate
    let reward_info = &mut pool.reward_infos[reward_index];

    let total_amount = if carry_forward {
        let (accumulated_ineligible_reward, _) = U256::from(reward_info.reward_rate)
            .safe_mul(U256::from(
                reward_info.cumulative_seconds_with_empty_liquidity_reward,
            ))?
            .overflowing_shr(SCALE_OFFSET.into());

        let carry_forward_ineligible_reward: u64 = accumulated_ineligible_reward
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?;

        // Reset cumulative seconds with empty liquidity reward because it will be brought forward to next reward window
        reward_info.cumulative_seconds_with_empty_liquidity_reward = 0;

        amount.safe_add(carry_forward_ineligible_reward)?
    } else {
        // Because the program only keep track of cumulative seconds of rewards with empty liquidity, and funding will affect the reward rate, which directly affect ineligible reward calculation.
        // ineligible_reward = reward_rate_per_seconds * cumulative_seconds_with_empty_liquidity_reward
        require!(
            reward_info.cumulative_seconds_with_empty_liquidity_reward == 0,
            PoolError::MustWithdrawnIneligibleReward
        );

        amount
    };

    // Reward rate might include ineligible reward based on whether to brought forward
    reward_info.update_rate_after_funding(current_time as u64, total_amount)?;

    if amount > 0 {
        // Transfer without ineligible reward because it's already in the vault
        ctx.accounts.transfer_from_funder_to_vault(amount)?;
    }

    emit_cpi!(EvtFundReward {
        pool: ctx.accounts.pool.key(),
        funder: ctx.accounts.funder.key(),
        reward_index: index,
        amount,
    });

    Ok(())
}
