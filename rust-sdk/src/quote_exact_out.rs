use crate::utils::*;
use anyhow::{ensure, Ok, Result};
use cp_amm::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool, SwapResult},
};

pub fn get_quote(
    pool: &Pool,
    current_timestamp: u64,
    current_slot: u64,
    actual_amount_out: u64,
    a_to_b: bool,
    has_referral: bool,
) -> Result<(u64, SwapResult)> {
    ensure!(actual_amount_out > 0, "amount is zero");

    let current_point = get_current_point(pool.activation_type, current_slot, current_timestamp)?;
    ensure!(
        is_pool_open_for_swap(pool, current_point)?,
        "Swap is disabled"
    );

    let trade_direction = if a_to_b {
        TradeDirection::AtoB
    } else {
        TradeDirection::BtoA
    };

    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = pool.get_swap_result_from_exact_output(
        actual_amount_out,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    let in_amount = swap_result.included_fee_input_amount;
    Ok((in_amount, swap_result.into()))
}
