use anyhow::{Context, Result};
use cp_amm::{
    state::{Pool, PoolStatus},
    ActivationType,
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
