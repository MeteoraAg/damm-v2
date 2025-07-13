use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::seeds::POOL_AUTHORITY_PREFIX,
    get_pool_access_validator,
    state::{Pool, Position, SplitAmountInfo},
    EvtSplitPosition, EvtSplitPositionInfo, PoolError,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SplitPositionParameters {
    /// Percentage of unlocked liquidity to allocate to the second position
    pub unlocked_liquidity_percentage: u8,
    /// Percentage of permanent locked liquidity to allocate to the second position
    pub permanent_locked_liquidity_percentage: u8,
    /// Percentage of accumulated fee A to allocate to the second position
    pub fee_a_percentage: u8,
    /// Percentage of accumulated fee B to allocate to the second position
    pub fee_b_percentage: u8,
    /// Percentage of accumulated reward 0 to allocate to the second position
    pub reward_0_percentage: u8,
    /// Percentage of accumulated reward 1 to allocate to the second position
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
    /// CHECK: pool authority
    #[account(seeds = [POOL_AUTHORITY_PREFIX.as_ref()], bump)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    /// The first position
    #[account(
        mut,
        has_one = pool,
    )]
    pub first_position: AccountLoader<'info, Position>,

    /// The token account for position nft
    #[account(
        constraint = first_position_nft_account.mint == first_position.load()?.nft_mint,
        constraint = first_position_nft_account.amount == 1,
        token::authority = owner_1
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
        token::authority = owner_2
)]
    pub second_position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Owner of first position
    pub owner_1: Signer<'info>,

    /// Owner of second position
    pub owner_2: Signer<'info>,
}

pub fn handle_split_position(
    ctx: Context<SplitPositionCtx>,
    params: SplitPositionParameters,
) -> Result<()> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_remove_liquidity(),
            PoolError::PoolDisabled
        );
    }

    params.validate()?;

    // can not split two same position
    require_keys_neq!(
        ctx.accounts.first_position.key(),
        ctx.accounts.second_position.key(),
        PoolError::SamePosition
    );

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

    require!(
        first_position.vested_liquidity == 0,
        PoolError::UnsupportPositionHasVestingLock
    );

    // update current pool reward & postion reward for first and second
    let current_time = Clock::get()?.unix_timestamp as u64;
    first_position.update_rewards(&mut pool, current_time)?;
    second_position.update_rewards(&mut pool, current_time)?;

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
        owner_1: ctx.accounts.owner_1.key(),
        owner_2: ctx.accounts.owner_2.key(),
        first_position: ctx.accounts.first_position.key(),
        second_position: ctx.accounts.second_position.key(),
        amount_splits: EvtSplitPositionInfo {
            unlocked_liquidity: split_amount_info.unlocked_liquidity,
            permanent_locked_liquidity: split_amount_info.permanent_locked_liquidity,
            fee_a: split_amount_info.fee_a,
            fee_b: split_amount_info.fee_b,
            reward_0: split_amount_info.reward_0,
            reward_1: split_amount_info.reward_1
        },
        first_position_info: EvtSplitPositionInfo {
            unlocked_liquidity: first_position.unlocked_liquidity,
            permanent_locked_liquidity: first_position.permanent_locked_liquidity,
            fee_a: first_position.fee_a_pending,
            fee_b: first_position.fee_b_pending,
            reward_0: first_position
                .reward_infos
                .get(0)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
            reward_1: first_position
                .reward_infos
                .get(1)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
        },
        second_position_info: EvtSplitPositionInfo {
            unlocked_liquidity: second_position.unlocked_liquidity,
            permanent_locked_liquidity: second_position.permanent_locked_liquidity,
            fee_a: second_position.fee_a_pending,
            fee_b: second_position.fee_b_pending,
            reward_0: second_position
                .reward_infos
                .get(0)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
            reward_1: second_position
                .reward_infos
                .get(1)
                .map(|r| r.reward_pendings)
                .unwrap_or(0),
        },
        split_position_parameters: params
    });

    Ok(())
}
