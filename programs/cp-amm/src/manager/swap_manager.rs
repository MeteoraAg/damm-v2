use crate::{
    activation_handler::ActivationHandler,
    constants::fee::{FEE_DENOMINATOR, MAX_BASIS_POINT},
    get_pool_access_validator_without_clock,
    params::swap::TradeDirection,
    safe_math::SafeMath,
    state::{fee::FeeMode, Pool, SwapResult2},
    PoolError, SwapMode,
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

    // TODO: PR support for exact out on JUP in the future
    let swap_mode = SwapMode::ExactIn;

    let SwapResult2 {
        output_amount,
        trading_fee: lp_fee,
        protocol_fee,
        trade_fee_numerator,
        ..
    } = match swap_mode {
        SwapMode::ExactIn => pool.get_swap_result_from_exact_input(
            amount_in,
            &fee_mode,
            trade_direction,
            current_point,
        )?,
        _ => {
            unreachable!("Unsupported swap mode")
        }
    };

    let fee_mint = if fee_mode.fees_on_token_a {
        pool.token_a_mint
    } else {
        pool.token_b_mint
    };

    let fee_amount = lp_fee.safe_add(protocol_fee)?;

    let fee_bps = u128::from(trade_fee_numerator)
        .safe_mul(MAX_BASIS_POINT.into())?
        .safe_div(FEE_DENOMINATOR.into())?;

    Ok(SwapFinalResult {
        out_amount: output_amount,
        fee_amount,
        fee_mint,
        fee_bps,
    })
}
