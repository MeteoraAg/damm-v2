use anchor_lang::prelude::*;

use crate::{
    constants::{REWARD_INDEX_0, REWARD_INDEX_1, SPLIT_POSITION_DENOMINATOR},
    get_pool_access_validator,
    state::{SplitAmountInfo, SplitPositionInfo},
    EvtSplitPosition2, PoolError, SplitPositionCtx,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SplitPositionParameters2 {
    pub unlocked_liquidity_numerator: u32,
    pub permanent_locked_liquidity_numerator: u32,
    pub fee_a_numerator: u32,
    pub fee_b_numerator: u32,
    pub reward_0_numerator: u32,
    pub reward_1_numerator: u32,
}

impl SplitPositionParameters2 {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.unlocked_liquidity_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.permanent_locked_liquidity_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.fee_a_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.fee_b_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.reward_0_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );
        require!(
            self.reward_1_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );

        require!(
            self.unlocked_liquidity_numerator > 0
                || self.permanent_locked_liquidity_numerator > 0
                || self.fee_a_numerator > 0
                || self.fee_b_numerator > 0
                || self.reward_0_numerator > 0
                || self.reward_1_numerator > 0,
            PoolError::InvalidSplitPositionParameters
        );

        Ok(())
    }
}

pub fn handle_split_position2(
    ctx: Context<SplitPositionCtx>,
    params: SplitPositionParameters2,
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

    let SplitPositionParameters2 {
        unlocked_liquidity_numerator,
        permanent_locked_liquidity_numerator,
        fee_a_numerator,
        fee_b_numerator,
        reward_0_numerator,
        reward_1_numerator,
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
        unlocked_liquidity_numerator,
        permanent_locked_liquidity_numerator,
        fee_a_numerator,
        fee_b_numerator,
        reward_0_numerator,
        reward_1_numerator,
    )?;

    emit_cpi!(EvtSplitPosition2 {
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
