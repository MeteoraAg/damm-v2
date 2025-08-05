use anyhow::{ensure, Ok, Result};
use cp_amm::{fee_math::pow, safe_math::SafeMath, utils_math::sqrt_u128};
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

    let xy_u256 = U256::from(token_b_amount)
        .safe_shl(128)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?
        .safe_div(
            U256::from(token_a_amount)
                .safe_mul(U256::from(max_sqrt_price))
                .map_err(|_| anyhow::anyhow!("Math overflow"))?,
        )
        .map_err(|_| anyhow::anyhow!("Math overflow"))?;

    let xy = u128::try_from(xy_u256).map_err(|_| anyhow::anyhow!("Type cast failed"))?;

    let four_y_u256 = U256::from(token_b_amount)
        .safe_shl(128)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?
        .safe_div(U256::from(token_a_amount))
        .map_err(|_| anyhow::anyhow!("Math overflow"))?
        .safe_mul(U256::from(4))
        .map_err(|_| anyhow::anyhow!("Math overflow"))?;

    let four_y = u128::try_from(four_y_u256).map_err(|_| anyhow::anyhow!("Type cast failed"))?;

    let xy_minus_pa_abs = if xy > min_sqrt_price {
        xy.safe_sub(min_sqrt_price)
            .map_err(|_| anyhow::anyhow!("Math overflow"))?
    } else {
        min_sqrt_price
            .safe_sub(xy)
            .map_err(|_| anyhow::anyhow!("Math overflow"))?
    };

    let pow_xy_minus_pa =
        pow(xy_minus_pa_abs, 2).ok_or_else(|| anyhow::anyhow!("Failed to calculate pow"))?;

    let discriminant = pow_xy_minus_pa
        .safe_add(four_y)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?;
    let sqrt_discriminant =
        sqrt_u128(discriminant).ok_or_else(|| anyhow::anyhow!("Math overflow"))?;

    let sqrt_price = sqrt_discriminant
        .safe_sub(xy)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?
        .safe_add(min_sqrt_price)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?
        .safe_div(2)
        .map_err(|_| anyhow::anyhow!("Math overflow"))?;

    Ok(sqrt_price)
}
