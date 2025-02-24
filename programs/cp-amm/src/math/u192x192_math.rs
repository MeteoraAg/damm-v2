use ruint::aliases::{U192, U256};

use super::u128x128_math::Rounding;

/// (x * y) >> offset
/// roundown
#[inline]
pub fn mul_shr_u192(x: U192, y: U192, offset: u8) -> Option<U192> {
    let x = U256::from(x);
    let y = U256::from(y);
    let prod = x.checked_mul(y)?;

    let (quotient, _) = prod.overflowing_shr(offset.into());

    Some(U192::from(quotient))
}

/// (x << offset) / y
#[inline]
pub fn shl_div_u192(x: U192, y: U192, offset: u8, rounding: Rounding) -> Option<U192> {
    if y == U192::ZERO {
        return None;
    }

    let denominator = U256::from(y);
    let prod = U256::from(x).checked_shl(offset as usize)?;
    let result = match rounding {
        Rounding::Up => prod.div_ceil(denominator),
        Rounding::Down => {
            let (quotient, _) = prod.div_rem(denominator);
            quotient
        }
    };

    Some(U192::from(result))
}
