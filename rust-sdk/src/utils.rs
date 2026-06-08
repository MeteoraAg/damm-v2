use anyhow::{Context, Error, Result};
use cp_amm::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, CollectFeeMode, Pool, PoolStatus, SwapResult2},
    ActivationType, CompoundingLiquidity, LiquidityHandler,
};

pub fn get_current_point(
    activation_type: u8,
    current_slot: u64,
    current_timestamp: u64,
) -> Result<u64> {
    let activation_type =
        ActivationType::try_from(activation_type).context("invalid activation type")?;

    let current_point = match activation_type {
        ActivationType::Slot => current_slot,
        ActivationType::Timestamp => current_timestamp,
    };

    Ok(current_point)
}

pub fn is_swap_enable(pool: &Pool, current_point: u64) -> Result<bool> {
    let pool_status = PoolStatus::try_from(pool.pool_status).context("invalid pool status")?;
    Ok(pool_status == PoolStatus::Enable && current_point >= pool.activation_point)
}

pub fn apply_next_sqrt_price(
    pool: &Pool,
    swap_result: &SwapResult2,
    fee_mode: &FeeMode,
    trade_direction: TradeDirection,
    collect_fee_mode: CollectFeeMode,
) -> Result<u128> {
    if collect_fee_mode != CollectFeeMode::Compounding {
        return Ok(swap_result.next_sqrt_price);
    }

    let trading_fee = swap_result
        .claiming_fee
        .checked_add(swap_result.compounding_fee)
        .ok_or_else(|| Error::msg("Math overflow"))?;

    let included_fee_output_amount = if fee_mode.fees_on_input {
        swap_result.output_amount
    } else {
        swap_result
            .output_amount
            .checked_add(trading_fee)
            .and_then(|v| v.checked_add(swap_result.protocol_fee))
            .and_then(|v| v.checked_add(swap_result.referral_fee))
            .ok_or_else(|| Error::msg("Math overflow"))?
    };

    let (new_token_a, new_token_b) = match trade_direction {
        TradeDirection::AtoB => {
            let a = pool
                .token_a_amount
                .checked_add(swap_result.excluded_fee_input_amount)
                .ok_or_else(|| Error::msg("Math overflow"))?;
            let b = pool
                .token_b_amount
                .checked_sub(included_fee_output_amount)
                .ok_or_else(|| Error::msg("Math overflow"))?;
            (a, b)
        }
        TradeDirection::BtoA => {
            let b = pool
                .token_b_amount
                .checked_add(swap_result.excluded_fee_input_amount)
                .ok_or_else(|| Error::msg("Math overflow"))?;
            let a = pool
                .token_a_amount
                .checked_sub(included_fee_output_amount)
                .ok_or_else(|| Error::msg("Math overflow"))?;
            (a, b)
        }
    };

    let new_token_b = new_token_b
        .checked_add(swap_result.compounding_fee)
        .ok_or_else(|| Error::msg("Math overflow"))?;

    let handler = CompoundingLiquidity {
        token_a_amount: new_token_a,
        token_b_amount: new_token_b,
        liquidity: pool.liquidity,
    };

    Ok(handler.get_next_sqrt_price(0)?)
}
