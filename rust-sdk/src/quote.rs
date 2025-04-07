use anyhow::{Context, Result, ensure};
use cp_amm::{
    ActivationType,
    params::swap::TradeDirection,
    state::{Pool, SwapResult, fee::FeeMode},
};

pub fn get_quote(
    pool: &Pool,
    current_timestamp: u64,
    current_slot: u64,
    actual_amount_in: u64,
    a_to_b: bool,
    has_referral: bool,
) -> Result<SwapResult> {
    let mut pool = *pool;

    ensure!(actual_amount_in > 0, "amount is zero");

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

    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result =
        pool.get_swap_result(actual_amount_in, fee_mode, trade_direction, current_point)?;

    Ok(swap_result)
}
