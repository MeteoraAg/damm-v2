use anchor_lang::prelude::*;

use crate::{
    activation_handler::ActivationHandler,
    constants::{REWARD_INDEX_0, REWARD_INDEX_1, SPLIT_POSITION_DENOMINATOR},
    get_pool_access_validator,
    state::{Position, SplitAmountInfo2, SplitPositionInfo},
    EvtSplitPosition2, EvtSplitPosition3, PoolError, SplitPositionCtx,
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

impl From<SplitPositionParameters2> for SplitPositionParameters3 {
    fn from(params: SplitPositionParameters2) -> Self {
        SplitPositionParameters3 {
            unlocked_liquidity_numerator: params.unlocked_liquidity_numerator,
            permanent_locked_liquidity_numerator: params.permanent_locked_liquidity_numerator,
            fee_a_numerator: params.fee_a_numerator,
            fee_b_numerator: params.fee_b_numerator,
            reward_0_numerator: params.reward_0_numerator,
            reward_1_numerator: params.reward_1_numerator,
            inner_vesting_liquidity_numerator: 0,
            padding: [0u128; 4],
        }
    }
}

impl From<SplitPositionParameters3> for SplitPositionParameters2 {
    fn from(params: SplitPositionParameters3) -> Self {
        SplitPositionParameters2 {
            unlocked_liquidity_numerator: params.unlocked_liquidity_numerator,
            permanent_locked_liquidity_numerator: params.permanent_locked_liquidity_numerator,
            fee_a_numerator: params.fee_a_numerator,
            fee_b_numerator: params.fee_b_numerator,
            reward_0_numerator: params.reward_0_numerator,
            reward_1_numerator: params.reward_1_numerator,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct SplitPositionParameters3 {
    pub unlocked_liquidity_numerator: u32,
    pub permanent_locked_liquidity_numerator: u32,
    pub fee_a_numerator: u32,
    pub fee_b_numerator: u32,
    pub reward_0_numerator: u32,
    pub reward_1_numerator: u32,
    pub inner_vesting_liquidity_numerator: u32,
    pub padding: [u128; 4],
}

impl SplitPositionParameters3 {
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
            self.inner_vesting_liquidity_numerator <= SPLIT_POSITION_DENOMINATOR,
            PoolError::InvalidSplitPositionParameters
        );

        require!(
            self.unlocked_liquidity_numerator > 0
                || self.permanent_locked_liquidity_numerator > 0
                || self.fee_a_numerator > 0
                || self.fee_b_numerator > 0
                || self.reward_0_numerator > 0
                || self.reward_1_numerator > 0
                || self.inner_vesting_liquidity_numerator > 0,
            PoolError::InvalidSplitPositionParameters
        );

        Ok(())
    }
}

fn check_position_split_validity(
    first_position: &Position,
    second_position: &Position,
) -> Result<()> {
    // Destination account cannot have inner vesting lock
    require!(
        second_position.inner_vesting.is_empty(),
        PoolError::UnsupportPositionHasVestingLock
    );

    // Source account cannot have external vesting lock. This is to prevent user refreshed vesting and accidentally splitted vested liquidity portion to destination account.
    let remaining_inner_vested_liquidity = first_position
        .inner_vesting
        .calculate_remaining_vested_liquidity()?;

    require!(
        remaining_inner_vested_liquidity == first_position.vested_liquidity,
        PoolError::UnsupportPositionHasVestingLock
    );

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SplitPositionInfo2 {
    pub liquidity: u128,
    pub fee_a: u64,
    pub fee_b: u64,
    pub reward_0: u64,
    pub reward_1: u64,
    pub vesting_liquidity: u128,
}

pub fn handle_split_position2(
    ctx: Context<SplitPositionCtx>,
    params: SplitPositionParameters3,
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

    let SplitPositionParameters3 {
        unlocked_liquidity_numerator,
        permanent_locked_liquidity_numerator,
        fee_a_numerator,
        fee_b_numerator,
        reward_0_numerator,
        reward_1_numerator,
        inner_vesting_liquidity_numerator,
        ..
    } = params;

    let mut pool = ctx.accounts.pool.load_mut()?;

    let mut first_position = ctx.accounts.first_position.load_mut()?;
    let mut second_position = ctx.accounts.second_position.load_mut()?;

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    first_position.refresh_inner_vesting(current_point)?;
    second_position.refresh_inner_vesting(current_point)?;

    if inner_vesting_liquidity_numerator > 0 && !first_position.inner_vesting.is_empty() {
        check_position_split_validity(&first_position, &second_position)?;
    }

    let current_time = Clock::get()?.unix_timestamp as u64;
    // update current pool reward
    pool.update_rewards(current_time)?;
    // update first and second position reward
    first_position.update_position_reward(&pool)?;
    second_position.update_position_reward(&pool)?;

    let split_amount_info: SplitAmountInfo2 = pool.apply_split_position(
        &mut first_position,
        &mut second_position,
        unlocked_liquidity_numerator,
        permanent_locked_liquidity_numerator,
        fee_a_numerator,
        fee_b_numerator,
        reward_0_numerator,
        reward_1_numerator,
        inner_vesting_liquidity_numerator,
        current_point,
    )?;

    emit_cpi!(EvtSplitPosition2 {
        pool: ctx.accounts.pool.key(),
        first_owner: ctx.accounts.first_owner.key(),
        second_owner: ctx.accounts.second_owner.key(),
        first_position: ctx.accounts.first_position.key(),
        second_position: ctx.accounts.second_position.key(),
        amount_splits: split_amount_info.into(),
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
        split_position_parameters: params.into()
    });

    emit_cpi!(EvtSplitPosition3 {
        pool: ctx.accounts.pool.key(),
        first_owner: ctx.accounts.first_owner.key(),
        second_owner: ctx.accounts.second_owner.key(),
        first_position: ctx.accounts.first_position.key(),
        second_position: ctx.accounts.second_position.key(),
        amount_splits: split_amount_info,
        current_sqrt_price: pool.sqrt_price,
        first_position_info: SplitPositionInfo2 {
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
            vesting_liquidity: first_position.vested_liquidity,
        },
        second_position_info: SplitPositionInfo2 {
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
            vesting_liquidity: second_position.vested_liquidity,
        },
        split_position_parameters: params,
    });

    Ok(())
}
