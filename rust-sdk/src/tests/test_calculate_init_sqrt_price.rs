use cp_amm::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    math::safe_math::SafeMath,
    state::{ModifyLiquidityResult, Pool},
    utils_math::safe_shl_div_cast,
};

use crate::calculate_init_sqrt_price::calculate_init_price;

fn get_liquidity_delta_from_amount_b(
    amount_b: u64,
    low_sqrt_price: u128,
    upper_sqrt_price: u128,
) -> u128 {
    let denominator = upper_sqrt_price.safe_sub(low_sqrt_price).unwrap();
    let liquidity_delta = safe_shl_div_cast(
        amount_b.into(),
        denominator,
        128,
        cp_amm::u128x128_math::Rounding::Down,
    )
    .unwrap();

    liquidity_delta
}
#[test]
fn test_calculate_init_sqrt_price() {
    let token_a_in_amount = 1_000_000 * 1_000_000_000;
    let token_b_in_amount = 5 * 1_000_000_000;
    let init_sqrt_price = calculate_init_price(
        token_a_in_amount,
        token_b_in_amount,
        MIN_SQRT_PRICE,
        MAX_SQRT_PRICE,
    )
    .unwrap();

    println!("init_sqrt_price: {:?}", init_sqrt_price);

    let pool = Pool {
        sqrt_min_price: MIN_SQRT_PRICE,
        sqrt_max_price: MAX_SQRT_PRICE,
        sqrt_price: init_sqrt_price,
        ..Default::default()
    };

    let liquidity_delta =
        get_liquidity_delta_from_amount_b(token_b_in_amount, MIN_SQRT_PRICE, init_sqrt_price);
    let ModifyLiquidityResult {
        token_a_amount,
        token_b_amount,
    } = pool
        .get_amounts_for_modify_liquidity(liquidity_delta, cp_amm::u128x128_math::Rounding::Up)
        .unwrap();

    // The small difference in token_a is expected due to rounding in liquidity calculations
    let token_a_diff = (token_a_amount as i128 - token_a_in_amount as i128).abs();
    assert!(
        token_a_diff <= 10, // Allow up to 10 lamport difference
        "token_a_amount difference {} is too large (got: {}, expected: {})",
        token_a_diff,
        token_a_amount,
        token_a_in_amount
    );

    // The small difference in token_b is expected due to rounding in liquidity calculations
    let token_b_diff = (token_b_amount as i128 - token_b_in_amount as i128).abs();
    assert!(
        token_b_diff <= 10, // Allow up to 10 lamport difference
        "token_b_amount difference {} is too large (got: {}, expected: {})",
        token_b_diff,
        token_b_amount,
        token_b_in_amount
    );
}
