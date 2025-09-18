use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::SPLIT_POSITION_DENOMINATOR,
    safe_math::SafeMath,
    state::{Pool, Position},
    PoolError, SplitPositionParameters2,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SplitPositionParameters {
    /// Percentage of unlocked liquidity to split to the second position
    pub unlocked_liquidity_percentage: u8,
    /// Percentage of permanent locked liquidity to split to the second position
    pub permanent_locked_liquidity_percentage: u8,
    /// Percentage of fee A pending to split to the second position
    pub fee_a_percentage: u8,
    /// Percentage of fee B pending to split to the second position
    pub fee_b_percentage: u8,
    /// Percentage of reward 0 pending to split to the second position
    pub reward_0_percentage: u8,
    /// Percentage of reward 1 pending to split to the second position
    pub reward_1_percentage: u8,
    /// padding for future
    pub padding: [u8; 16],
}

impl SplitPositionParameters {
    pub fn get_split_position_parameters2(&self) -> Result<SplitPositionParameters2> {
        self.validate()?;
        let numerator_factor = SPLIT_POSITION_DENOMINATOR.safe_div(100)?;

        Ok(SplitPositionParameters2 {
            unlocked_liquidity_numerator: numerator_factor
                .safe_mul(self.unlocked_liquidity_percentage.into())?,
            permanent_locked_liquidity_numerator: numerator_factor
                .safe_mul(self.permanent_locked_liquidity_percentage.into())?,
            fee_a_numerator: numerator_factor.safe_mul(self.fee_a_percentage.into())?,
            fee_b_numerator: numerator_factor.safe_mul(self.fee_b_percentage.into())?,
            reward_0_numerator: numerator_factor.safe_mul(self.reward_0_percentage.into())?,
            reward_1_numerator: numerator_factor.safe_mul(self.reward_1_percentage.into())?,
        })
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.permanent_locked_liquidity_percentage <= 100,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.unlocked_liquidity_percentage <= 100,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.fee_a_percentage <= 100,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.fee_b_percentage <= 100,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.reward_0_percentage <= 100,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.reward_1_percentage <= 100,
            PoolError::InvalidSplitPositionParameters
        );

        require!(
            self.unlocked_liquidity_percentage > 0
                || self.permanent_locked_liquidity_percentage > 0
                || self.fee_a_percentage > 0
                || self.fee_b_percentage > 0
                || self.reward_0_percentage > 0
                || self.reward_1_percentage > 0,
            PoolError::InvalidSplitPositionParameters
        );

        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct SplitPositionCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    /// The first position
    #[account(
        mut,
        has_one = pool,
        constraint = first_position.key() != second_position.key() @ PoolError::SamePosition,
    )]
    pub first_position: AccountLoader<'info, Position>,

    /// The token account for position nft
    #[account(
        constraint = first_position_nft_account.mint == first_position.load()?.nft_mint,
        constraint = first_position_nft_account.amount == 1,
        token::authority = first_owner
    )]
    pub first_position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The second position
    #[account(
        mut,
        has_one = pool,
    )]
    pub second_position: AccountLoader<'info, Position>,

    /// The token account for position nft
    #[account(
        constraint = second_position_nft_account.mint == second_position.load()?.nft_mint,
        constraint = second_position_nft_account.amount == 1,
        token::authority = second_owner
    )]
    pub second_position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Owner of first position
    pub first_owner: Signer<'info>,

    /// Owner of second position
    pub second_owner: Signer<'info>,
}
