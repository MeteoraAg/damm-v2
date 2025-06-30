use anyhow::{ensure, Context, Error, Ok, Result};
use cp_amm::{
    constants::fee::FEE_DENOMINATOR,
    curve::{get_delta_amount_a_unsigned, get_delta_amount_b_unsigned},
    params::swap::TradeDirection,
    state::{
        fee::{FeeMode, FeeOnAmountResult},
        Pool, SwapResult,
    },
    u128x128_math::{mul_div_u256, Rounding},
    utils_math::safe_mul_div_cast_u64,
    ActivationType,
};
use ruint::aliases::U256;

use crate::safe_math::SafeMath;

pub fn quote_exact_out(
    pool: &Pool,
    current_timestamp: u64,
    current_slot: u64,
    included_transfer_fee_out_amount: u64,
    a_to_b: bool,
) -> Result<(SwapResult, u64)> {
    ensure!(included_transfer_fee_out_amount > 0, "amount is zero");
    let mut pool = *pool;
    pool.update_pre_swap(current_timestamp)?;

    let activation_type =
        ActivationType::try_from(pool.activation_type).context("invalid activation type")?;
    let current_point = match activation_type {
        ActivationType::Slot => current_slot,
        ActivationType::Timestamp => current_timestamp,
    };

    let trade_direction = if a_to_b {
        TradeDirection::AtoB
    } else {
        TradeDirection::BtoA
    };

    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, false)?;

    let swap_result = get_swap_result_from_out_amount(
        &pool,
        included_transfer_fee_out_amount,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    Ok(swap_result)
}

fn get_swap_result_from_out_amount(
    pool: &Pool,
    out_amount: u64,
    fee_mode: &FeeMode,
    trade_direction: TradeDirection,
    current_point: u64,
) -> Result<(SwapResult, u64)> {
    let mut actual_protocol_fee = 0;
    let mut actual_lp_fee = 0;
    let mut actual_partner_fee = 0;
    let mut actual_referral_fee = 0;

    let trade_fee_numerator = pool
        .pool_fees
        .get_total_trading_fee(current_point, pool.activation_point)?
        .try_into()
        .map_err(|_| Error::msg("Typecase is failed"))?;

    let included_fee_out_amount = if fee_mode.fees_on_input {
        out_amount
    } else {
        let included_fee_out_amount = get_included_fee_amount(trade_fee_numerator, out_amount)?;
        let FeeOnAmountResult {
            amount: _,
            protocol_fee,
            lp_fee,
            partner_fee,
            referral_fee,
        } = pool.pool_fees.get_fee_on_amount(
            out_amount,
            fee_mode.has_referral,
            current_point,
            pool.activation_point,
        )?;
        actual_protocol_fee = protocol_fee;
        actual_lp_fee = lp_fee;
        actual_referral_fee = referral_fee;
        actual_partner_fee = partner_fee;
        included_fee_out_amount
    };

    let SwapAmount {
        output_amount: excluded_fee_in_amount,
        next_sqrt_price,
    } = match trade_direction {
        TradeDirection::AtoB => {
            // reverse
            get_in_amount_from_a_to_b(pool, included_fee_out_amount)?
        }
        TradeDirection::BtoA => get_in_amount_from_b_to_a(pool, included_fee_out_amount)?,
    };

    let included_fee_in_amount = if fee_mode.fees_on_input {
        let included_fee_in_amount =
            get_included_fee_amount(trade_fee_numerator, excluded_fee_in_amount)?;
        let FeeOnAmountResult {
            amount: _,
            protocol_fee,
            lp_fee,
            partner_fee,
            referral_fee,
        } = pool.pool_fees.get_fee_on_amount(
            included_fee_in_amount,
            fee_mode.has_referral,
            current_point,
            pool.activation_point,
        )?;
        actual_protocol_fee = protocol_fee;
        actual_lp_fee = lp_fee;
        actual_referral_fee = referral_fee;
        actual_partner_fee = partner_fee;
        included_fee_in_amount
    } else {
        excluded_fee_in_amount
    };

    Ok((
        SwapResult {
            output_amount: out_amount,
            next_sqrt_price,
            lp_fee: actual_lp_fee,
            protocol_fee: actual_protocol_fee,
            referral_fee: actual_referral_fee,
            partner_fee: actual_partner_fee,
        },
        included_fee_in_amount,
    ))
}

pub struct SwapAmount {
    output_amount: u64,
    next_sqrt_price: u128,
}

fn get_excluded_fee_amount(
    trade_fee_numerator: u64,
    included_fee_amount: u64,
) -> Result<(u64, u64)> {
    let trading_fee: u64 = safe_mul_div_cast_u64(
        included_fee_amount,
        trade_fee_numerator,
        FEE_DENOMINATOR,
        Rounding::Up,
    )?;
    // update amount
    let excluded_fee_amount = included_fee_amount.safe_sub(trading_fee)?;
    Ok((excluded_fee_amount, trading_fee))
}

fn get_included_fee_amount(trade_fee_numerator: u64, excluded_fee_amount: u64) -> Result<u64> {
    let included_fee_amount: u64 = safe_mul_div_cast_u64(
        excluded_fee_amount,
        FEE_DENOMINATOR,
        FEE_DENOMINATOR.safe_sub(trade_fee_numerator)?,
        Rounding::Up,
    )?;
    // sanity check
    let (inverse_amount, _trading_fee) =
        get_excluded_fee_amount(trade_fee_numerator, included_fee_amount)?;
    // that should never happen
    ensure!(
        inverse_amount >= excluded_fee_amount,
        "inverse amount is less than excluded_fee_amount"
    );
    Ok(included_fee_amount)
}

fn get_in_amount_from_a_to_b(
    pool: &Pool,
    out_amount: u64, // quote amount
) -> Result<SwapAmount> {
    // finding new target price
    let next_sqrt_price =
        get_next_sqrt_price_from_output(pool.sqrt_price, pool.liquidity, out_amount, true)?;

    ensure!(
        next_sqrt_price >= pool.sqrt_min_price,
        "price range is violated"
    );

    // finding output amount
    let output_amount = get_delta_amount_a_unsigned(
        next_sqrt_price,
        pool.sqrt_price,
        pool.liquidity,
        Rounding::Up,
    )?;

    Ok(SwapAmount {
        output_amount,
        next_sqrt_price,
    })
}

fn get_in_amount_from_b_to_a(
    pool: &Pool,
    out_amount: u64, // base amount
) -> Result<SwapAmount> {
    // finding new target price
    let next_sqrt_price =
        get_next_sqrt_price_from_output(pool.sqrt_price, pool.liquidity, out_amount, false)?;

    ensure!(
        next_sqrt_price <= pool.sqrt_max_price,
        "price range is violated"
    );

    // finding output amount
    let output_amount = get_delta_amount_b_unsigned(
        pool.sqrt_price,
        next_sqrt_price,
        pool.liquidity,
        Rounding::Up,
    )?;

    Ok(SwapAmount {
        output_amount,
        next_sqrt_price,
    })
}

/// * `√P' = √P - Δy / L`
pub fn get_next_sqrt_price_from_amount_b_rounding_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    let liquidity = U256::from(liquidity);
    let quotient = U256::from(amount)
        .safe_shl(128)? // TODO remove unwrap
        .safe_add(liquidity)?
        .safe_sub(U256::from(1))?
        .safe_div(liquidity)?;
    let result = U256::from(sqrt_price).safe_sub(quotient)?;
    Ok(result
        .try_into()
        .map_err(|_| Error::msg("Typecast is error"))?)
}

///  √P' = √P * L / (L - Δx * √P)
pub fn get_next_sqrt_price_from_amount_a_rounding_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    if amount == 0 {
        return Ok(sqrt_price);
    }
    let sqrt_price = U256::from(sqrt_price);
    let liquidity = U256::from(liquidity);

    let product = U256::from(amount).safe_mul(sqrt_price)?;
    let denominator = liquidity.safe_sub(U256::from(product))?;
    let result = mul_div_u256(liquidity, sqrt_price, denominator, Rounding::Down)
        .ok_or_else(|| Error::msg("Typecast is error"))?;
    Ok(result
        .try_into()
        .map_err(|_| Error::msg("Typecast is error"))?)
}

pub fn get_next_sqrt_price_from_output(
    sqrt_price: u128,
    liquidity: u128,
    out_amount: u64,
    is_b: bool,
) -> Result<u128> {
    assert!(sqrt_price > 0);
    // round to make sure that we don't pass the target price
    if is_b {
        get_next_sqrt_price_from_amount_b_rounding_up(sqrt_price, liquidity, out_amount)
    } else {
        get_next_sqrt_price_from_amount_a_rounding_down(sqrt_price, liquidity, out_amount)
    }
}
