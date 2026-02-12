use cp_amm::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    utils_math::sqrt_u256,
};
use ruint::aliases::U256;

// a = L * (1/s - 1/pb)
// b = L * (s - pa)
// b/a = (s - pa) / (1/s - 1/pb)
// With: x = 1 / pb and y = b/a
// => s ^ 2 + s * (-pa + x * y) - y = 0
// s = [(pa - xy) + √((xy - pa)² + 4y)]/2, // pa: min_sqrt_price, pb: max_sqrt_price
// s = [(pa - b << 128 / a / pb) + sqrt((b << 128 / a / pb - pa)² + 4 * b << 128 / a)] / 2
pub fn calculate_concenstrated_initial_sqrt_price(
    token_a_amount: u64,
    token_b_amount: u64,
    min_sqrt_price: u128,
    max_sqrt_price: u128,
) -> Option<u128> {
    if token_a_amount == 0 || token_b_amount == 0 {
        return None;
    }

    let a = U256::from(token_a_amount);
    let b = U256::from(token_b_amount).checked_shl(128)?;
    let pa = U256::from(min_sqrt_price);
    let pb = U256::from(max_sqrt_price);

    let four = U256::from(4);
    let two = U256::from(2);

    let s = if b / a > pa * pb {
        let delta = b / a / pb - pa;
        let sqrt_value = sqrt_u256(delta * delta + four * b / a)?;
        (sqrt_value - delta) / two
    } else {
        let delta = pa - b / a / pb;
        let sqrt_value = sqrt_u256(delta * delta + four * b / a)?;
        (sqrt_value + delta) / two
    };
    u128::try_from(s).ok()
}

pub fn calculate_compounding_initial_sqrt_price_and_liquidity(
    token_a_amount: u64,
    token_b_amount: u64,
) -> Option<(u128, u128)> {
    // a = l/s and b = l * s
    // s1: sqrt_price round up
    // s2: sqrt_price round down
    // return (s1, a * s2)
    let sqrt_price_1 = sqrt_u256(
        U256::from(token_b_amount)
            .checked_shl(128)?
            .div_ceil(U256::from(token_a_amount)),
    )?;
    let sqrt_price_1 = u128::try_from(sqrt_price_1).ok()?;
    if sqrt_price_1 < MIN_SQRT_PRICE || sqrt_price_1 > MAX_SQRT_PRICE {
        return None;
    }

    let sqrt_price_2 = sqrt_u256(
        U256::from(token_b_amount)
            .checked_shl(128)?
            .checked_div(U256::from(token_a_amount))?,
    )?;
    let sqrt_price_2 = u128::try_from(sqrt_price_2).ok()?;
    let liquidity = sqrt_price_2.checked_mul(u128::from(token_a_amount))?;

    Some((sqrt_price_1, liquidity))
}
