use crate::utils::*;
use anyhow::{ensure, Ok, Result};
use cp_amm::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool, SwapResult2},
};

pub fn get_quote(
    pool: &Pool,
    current_timestamp: u64,
    current_slot: u64,
    actual_amount_in: u64,
    a_to_b: bool,
    has_referral: bool,
) -> Result<SwapResult2> {
    ensure!(actual_amount_in > 0, "amount is zero");

    let current_point = get_current_point(pool.activation_type, current_slot, current_timestamp)?;

    ensure!(is_swap_enable(pool, current_point)?, "Swap is disabled");

    let trade_direction = if a_to_b {
        TradeDirection::AtoB
    } else {
        TradeDirection::BtoA
    };

    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = pool.get_swap_result_from_partial_input(
        actual_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    Ok(swap_result)
}
