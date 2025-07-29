use crate::{
    activation_handler::ActivationHandler,
    constants::fee::{FEE_DENOMINATOR, MAX_BASIS_POINT, MAX_FEE_NUMERATOR},
    get_pool_access_validator_without_clock,
    params::swap::TradeDirection,
    safe_math::SafeMath,
    state::{fee::FeeMode, Pool, SwapResult},
    PoolError,
};
use anchor_lang::prelude::*;

pub struct SwapFinalResult {
    pub out_amount: u64,
    pub fee_amount: u64,
    pub fee_mint: Pubkey,
    pub fee_bps: u128,
}

pub fn swap(
    pool: &Pool,
    amount_in: u64,
    current_slot: u64,
    current_timestamp: i64,
    a_to_b: bool,
) -> Result<SwapFinalResult> {
    let access_validator =
        get_pool_access_validator_without_clock(&pool, current_slot, current_timestamp)?;

    require!(
        access_validator.can_swap(&Pubkey::default()),
        PoolError::PoolDisabled
    );

    handle_normal_swap(pool, amount_in, current_slot, current_timestamp, a_to_b)
}

fn handle_normal_swap(
    pool: &Pool,
    amount_in: u64,
    current_slot: u64,
    current_timestamp: i64,
    a_to_b: bool,
) -> Result<SwapFinalResult> {
    let trade_direction = if a_to_b {
        TradeDirection::AtoB
    } else {
        TradeDirection::BtoA
    };

    let current_point = ActivationHandler::get_current_point_without_clock(
        pool.activation_type,
        current_slot,
        current_timestamp,
    )?;

    let fee_mode = FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, false)?;

    let SwapResult {
        lp_fee,
        protocol_fee,
        output_amount,
        ..
    } = pool.get_swap_result(amount_in, &fee_mode, trade_direction, current_point)?;

    let fee_mint = if fee_mode.fees_on_token_a {
        pool.token_a_mint
    } else {
        pool.token_b_mint
    };

    let fee_amount = lp_fee.safe_add(protocol_fee)?;

    let trade_fee_numerator = pool
        .pool_fees
        .get_total_trading_fee(current_point, pool.activation_point)?
        .min(MAX_FEE_NUMERATOR.into());

    let fee_bps = trade_fee_numerator
        .safe_mul(MAX_BASIS_POINT.into())?
        .safe_div(FEE_DENOMINATOR.into())?;

    Ok(SwapFinalResult {
        out_amount: output_amount,
        fee_amount,
        fee_mint,
        fee_bps,
    })
}
