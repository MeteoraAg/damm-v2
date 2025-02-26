use anchor_lang::prelude::Result;
use num_traits::cast::FromPrimitive;
use ruint::aliases::U256;

use crate::{
    safe_math::SafeMath,
    u128x128_math::{mul_shr, shl_div, Rounding},
    PoolError,
};

/// safe_mul_shr_cast
#[inline]
pub fn safe_mul_shr_cast<T: FromPrimitive>(x: u128, y: u128, offset: u8) -> Result<T> {
    T::from_u128(mul_shr(x, y, offset).ok_or_else(|| PoolError::MathOverflow)?)
        .ok_or_else(|| PoolError::TypeCastFailed.into())
}

#[inline]
pub fn safe_mul_div_cast_u64<T: FromPrimitive>(x: u64, y: u64, denominator: u64) -> Result<T> {
    let result = u128::from(x)
        .safe_mul(y.into())?
        .safe_div(denominator.into())?;

    T::from_u128(result).ok_or_else(|| PoolError::TypeCastFailed.into())
}

#[inline]
pub fn safe_shl_div_cast<T: FromPrimitive>(
    x: u128,
    y: u128,
    offset: u8,
    rounding: Rounding,
) -> Result<T> {
    T::from_u128(shl_div(x, y, offset, rounding).ok_or_else(|| PoolError::MathOverflow)?)
        .ok_or_else(|| PoolError::TypeCastFailed.into())
}

pub trait U256Conversion {
    fn as_bytes(&self) -> [u8; 32];
    fn from_bytes(bytes: [u8; 32]) -> Self;
}

impl U256Conversion for U256 {
    fn as_bytes(&self) -> [u8; 32] {
        self.to_le_bytes::<32>()
    }

    fn from_bytes(bytes: [u8; 32]) -> Self {
        U256::from_le_bytes(bytes)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_convert() {
        let u256 = U256::from(100);
        let bytes = u256.as_bytes();
        let result = U256::from_le_bytes(bytes);

        assert_eq!(result, u256)
    }
}
