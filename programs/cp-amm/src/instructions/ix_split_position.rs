use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::{REWARD_INDEX_0, REWARD_INDEX_1},
    get_pool_access_validator,
    state::{Pool, Position, SplitAmountInfo, SplitPositionInfo},
    EvtSplitPosition, PoolError,
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

pub fn handle_split_position(
    ctx: Context<SplitPositionCtx>,
    params: SplitPositionParameters,
) -> Result<()> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_split_position(),
            PoolError::PoolDisabled
        );
    }

    // validate params
    params.validate()?;

    let SplitPositionParameters {
        unlocked_liquidity_percentage,
        permanent_locked_liquidity_percentage,
        fee_a_percentage,
        fee_b_percentage,
        reward_0_percentage,
        reward_1_percentage,
        ..
    } = params;

    let mut pool = ctx.accounts.pool.load_mut()?;

    let mut first_position = ctx.accounts.first_position.load_mut()?;
    let mut second_position = ctx.accounts.second_position.load_mut()?;

    // Require positions without vested liquidity to avoid complex logic.
    // Because a position can have multiple vested locks with different vesting time.
    require!(
        first_position.vested_liquidity == 0,
        PoolError::UnsupportPositionHasVestingLock
    );

    let current_time = Clock::get()?.unix_timestamp as u64;
    // update current pool reward
    pool.update_rewards(current_time)?;
    // update first and second position reward
    first_position.update_position_reward(&pool)?;
    second_position.update_position_reward(&pool)?;

    let split_amount_info: SplitAmountInfo = pool.apply_split_position(
        &mut first_position,
        &mut second_position,
        unlocked_liquidity_percentage,
        permanent_locked_liquidity_percentage,
        fee_a_percentage,
        fee_b_percentage,
        reward_0_percentage,
        reward_1_percentage,
    )?;

    emit_cpi!(EvtSplitPosition {
        pool: ctx.accounts.pool.key(),
        first_owner: ctx.accounts.first_owner.key(),
        second_owner: ctx.accounts.second_owner.key(),
        first_position: ctx.accounts.first_position.key(),
        second_position: ctx.accounts.second_position.key(),
        amount_splits: split_amount_info,
        current_sqrt_price: pool.sqrt_price,
        first_position_info: SplitPositionInfo {
            liquidity: first_position.get_total_liquidity()?,
            fee_a: first_position.fee_a_pending,
            fee_b: first_position.fee_b_pending,
            reward_0: first_position
                .reward_infos
                .get(REWARD_INDEX_0)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
            reward_1: first_position
                .reward_infos
                .get(REWARD_INDEX_1)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
        },
        second_position_info: SplitPositionInfo {
            liquidity: second_position.get_total_liquidity()?,
            fee_a: second_position.fee_a_pending,
            fee_b: second_position.fee_b_pending,
            reward_0: second_position
                .reward_infos
                .get(REWARD_INDEX_0)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
            reward_1: second_position
                .reward_infos
                .get(REWARD_INDEX_1)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
        },
        split_position_parameters: params
    });

    Ok(())
}
