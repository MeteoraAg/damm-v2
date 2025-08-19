use anyhow::{ensure, Ok, Result};
use cp_amm::{safe_math::SafeMath, utils_math::sqrt_u256};
use ruint::aliases::U256;

// a = L * (1/s - 1/pb)
// b = L * (s - pa)
// b/a = (s - pa) / (1/s - 1/pb)
// With: x = 1 / pb and y = b/a
// => s ^ 2 + s * (-pa + x * y) - y = 0
// s = [(pa - xy) + √((xy - pa)² + 4y)]/2, // pa: min_sqrt_price, pb: max_sqrt_price
// s = [(pa - b << 128 / a / pb) + sqrt((b << 128 / a / pb - pa)² + 4 * b << 128 / a)] / 2
pub fn calculate_init_price(
    token_a_amount: u64,
    token_b_amount: u64,
    min_sqrt_price: u128,
    max_sqrt_price: u128,
) -> Result<u128> {
    ensure!(
        token_a_amount != 0 && token_b_amount != 0,
        "Token amounts must be non-zero"
    );

    let token_a_amount_u256 = U256::from(token_a_amount);
    let token_b_amount_u256 = U256::from(token_b_amount)
        .safe_shl(128)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?;
    let min_sqrt_price_u256 = U256::from(min_sqrt_price);
    let max_sqrt_price_u256 = U256::from(max_sqrt_price);

    let xy = token_b_amount_u256 / (token_a_amount_u256 * max_sqrt_price_u256);

    let four_y = U256::from(4) * token_b_amount_u256 / token_a_amount_u256;

    let abs_xy_minus_pa = if xy > min_sqrt_price_u256 {
        xy - min_sqrt_price_u256
    } else {
        min_sqrt_price_u256 - xy
    };

    let discriminant = abs_xy_minus_pa * abs_xy_minus_pa + four_y;
    let sqrt_discriminant =
        sqrt_u256(discriminant).ok_or_else(|| anyhow::anyhow!("Math overflow"))?;

    let sqrt_price = (sqrt_discriminant - xy + min_sqrt_price_u256) / U256::from(2);

    Ok(u128::try_from(sqrt_price).map_err(|_| anyhow::anyhow!("Type cast failed"))?)
}
