// use super::u64x64_math::{pow, ONE, SCALE_OFFSET};
use crate::{fee_math::pow, safe_math::SafeMath, PoolError};
use anchor_lang::prelude::*;

const BASIS_POINT_MAX: u128 = 10_000;
const SCALE_OFFSET: u32 = 64;
pub const ONE: u128 = 1u128 << SCALE_OFFSET;

/// Calculate price based on the given bin id. Eg: 1.0001 ^ 5555. The returned value is in Q64.64
pub fn get_price_from_id(active_id: i32, bin_step: u16) -> Result<u128> {
    // Make bin_step into Q64x64, and divided by BASIS_POINT_MAX. If bin_step = 1, we get 0.0001 in Q64x64
    let bps = u128::from(bin_step)
        .safe_shl(SCALE_OFFSET.into())?
        .safe_div(BASIS_POINT_MAX as u128)?;
    // Add 1 to bps, we get 1.0001 in Q64.64
    let base = ONE.safe_add(bps)?;
    pow(base, active_id).ok_or_else(|| PoolError::MathOverflow.into())
}
