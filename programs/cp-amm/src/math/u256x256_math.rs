use ruint::aliases::{U256, U512};

use super::u128x128_math::Rounding;

/// (x * y) >> offset
/// roundown
#[inline]
pub fn mul_shr_u256(x: U256, y: U256, offset: u8) -> Option<U256> {
    let x = U512::from(x);
    let y = U512::from(y);
    let prod = x.checked_mul(y)?;

    let (quotient, _) = prod.overflowing_shr(offset.into());

    if quotient > U512::from(U256::MAX) {
        None
    } else {
        Some(U256::from(quotient))
    }
}

/// (x << offset) / y
#[inline]
pub fn shl_div_u256(x: U256, y: U256, offset: u8, rounding: Rounding) -> Option<U256> {
    if y == U256::ZERO {
        return None;
    }

    let denominator = U512::from(y);
    let prod = U512::from(x).checked_shl(offset as usize)?;
    let result = match rounding {
        Rounding::Up => prod.div_ceil(denominator),
        Rounding::Down => {
            let (quotient, _) = prod.div_rem(denominator);
            quotient
        }
    };

    if result > U512::from(U256::MAX) {
        None
    } else {
        Some(U256::from(result))
    }
}
