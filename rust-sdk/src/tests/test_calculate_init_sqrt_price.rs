use std::u64;

use cp_amm::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    math::safe_math::SafeMath,
    state::{ModifyLiquidityResult, Pool},
};
use ruint::aliases::{U256, U512};

use crate::calculate_init_sqrt_price::calculate_init_price;
use anyhow::{Ok, Result};

// Δa = L * (1 / √P_lower - 1 / √P_upper) => L = Δa / (1 / √P_lower - 1 / √P_upper)
fn get_initial_liquidity_from_amount_a(
    base_amount: u64,
    sqrt_max_price: u128,
    sqrt_price: u128,
) -> Result<U512> {
    let price_delta = U512::from(sqrt_max_price.safe_sub(sqrt_price).unwrap());
    let prod = U512::from(base_amount)
        .safe_mul(U512::from(sqrt_price))
        .unwrap()
        .safe_mul(U512::from(sqrt_max_price))
        .unwrap();
    let liquidity = prod.safe_div(price_delta).unwrap(); // round down
    Ok(liquidity)
}

// Δb = L (√P_upper - √P_lower) => L = Δb / (√P_upper - √P_lower)
fn get_initial_liquidity_from_amount_b(
    quote_amount: u64,
    sqrt_min_price: u128,
    sqrt_price: u128,
) -> Result<u128> {
    let price_delta = U256::from(sqrt_price.safe_sub(sqrt_min_price).unwrap());
    let quote_amount = U256::from(quote_amount).safe_shl(128).unwrap();
    let liquidity = quote_amount.safe_div(price_delta).unwrap(); // round down
    return Ok(liquidity
        .try_into()
        .map_err(|_| anyhow::anyhow!("Type cast failed"))?);
}

fn get_liquidity_for_adding_liquidity(
    base_amount: u64,
    quote_amount: u64,
    sqrt_price: u128,
    min_sqrt_price: u128,
    max_sqrt_price: u128,
) -> Result<u128> {
    let liquidity_from_base =
        get_initial_liquidity_from_amount_a(base_amount, max_sqrt_price, sqrt_price)?;
    let liquidity_from_quote =
        get_initial_liquidity_from_amount_b(quote_amount, min_sqrt_price, sqrt_price)?;
    if liquidity_from_base > U512::from(liquidity_from_quote) {
        Ok(liquidity_from_quote)
    } else {
        Ok(liquidity_from_base
            .try_into()
            .map_err(|_| anyhow::anyhow!("Type cast failed"))?)
    }
}

#[test]
fn test_b_div_a_larger_than_pa_mul_pb() {
    let token_a_in_amount = U256::from(1_000_000 * 1_000_000_000u64);
    let token_b_in_amount =
        (U256::from(MAX_SQRT_PRICE) * U256::from(MIN_SQRT_PRICE) * token_a_in_amount)
            .safe_shr(128)
            .unwrap();

    let a = u64::try_from(token_a_in_amount).unwrap();
    let b = u64::try_from(token_b_in_amount)
        .unwrap()
        .safe_add(1)
        .unwrap();

    let init_sqrt_price = calculate_init_price(a, b, MIN_SQRT_PRICE, MAX_SQRT_PRICE).unwrap();

    println!("init_sqrt_price: {:?}", init_sqrt_price);

    let pool = Pool {
        sqrt_min_price: MIN_SQRT_PRICE,
        sqrt_max_price: MAX_SQRT_PRICE,
        sqrt_price: init_sqrt_price,
        ..Default::default()
    };

    let liquidity_delta = get_liquidity_for_adding_liquidity(
        a,
        b,
        init_sqrt_price,
        pool.sqrt_min_price,
        pool.sqrt_max_price,
    )
    .unwrap();

    let ModifyLiquidityResult {
        token_a_amount,
        token_b_amount,
    } = pool
        .get_amounts_for_modify_liquidity(liquidity_delta, cp_amm::u128x128_math::Rounding::Up)
        .unwrap();

    // The small difference in token_a is expected due to rounding in liquidity calculations
    let token_a_diff = (token_a_amount as i128 - a as i128).abs();
    assert!(
        token_a_diff <= 10, // Allow up to 10 lamport difference
        "token_a_amount difference {} is too large (got: {}, expected: {})",
        token_a_diff,
        token_a_amount,
        token_a_in_amount
    );

    // The small difference in token_b is expected due to rounding in liquidity calculations
    let token_b_diff = (token_b_amount as i128 - b as i128).abs();
    assert!(
        token_b_diff <= 10, // Allow up to 10 lamport difference
        "token_b_amount difference {} is too large (got: {}, expected: {})",
        token_b_diff,
        token_b_amount,
        token_b_in_amount
    );
}

#[test]
fn test_b_div_a_less_than_pa_mul_pb() {
    let token_a_in_amount = U256::from(1_000_000 * 1_000_000_000u64);
    let token_b_in_amount =
        (U256::from(MAX_SQRT_PRICE) * U256::from(MIN_SQRT_PRICE) * token_a_in_amount)
            .safe_shr(128)
            .unwrap();

    let a = u64::try_from(token_a_in_amount).unwrap();
    let b = u64::try_from(token_b_in_amount)
        .unwrap()
        .safe_sub(1)
        .unwrap();

    let init_sqrt_price = calculate_init_price(a, b, MIN_SQRT_PRICE, MAX_SQRT_PRICE).unwrap();

    println!("init_sqrt_price: {:?}", init_sqrt_price);

    let pool = Pool {
        sqrt_min_price: MIN_SQRT_PRICE,
        sqrt_max_price: MAX_SQRT_PRICE,
        sqrt_price: init_sqrt_price,
        ..Default::default()
    };

    let liquidity_delta = get_liquidity_for_adding_liquidity(
        a,
        b,
        init_sqrt_price,
        pool.sqrt_min_price,
        pool.sqrt_max_price,
    )
    .unwrap();

    let ModifyLiquidityResult {
        token_a_amount,
        token_b_amount,
    } = pool
        .get_amounts_for_modify_liquidity(liquidity_delta, cp_amm::u128x128_math::Rounding::Up)
        .unwrap();

    // The small difference in token_a is expected due to rounding in liquidity calculations
    let token_a_diff = (token_a_amount as i128 - a as i128).abs();
    assert!(
        token_a_diff <= 10, // Allow up to 10 lamport difference
        "token_a_amount difference {} is too large (got: {}, expected: {})",
        token_a_diff,
        token_a_amount,
        token_a_in_amount
    );

    // The small difference in token_b is expected due to rounding in liquidity calculations
    let token_b_diff = (token_b_amount as i128 - b as i128).abs();
    assert!(
        token_b_diff <= 10, // Allow up to 10 lamport difference
        "token_b_amount difference {} is too large (got: {}, expected: {})",
        token_b_diff,
        token_b_amount,
        token_b_in_amount
    );
}

#[test]
fn test_b_div_a_equal_pa_mul_pb() {
    let b = 1_000_000u64;
    let token_b_in_amount = U256::from(b).safe_shl(128).unwrap();
    let token_a_in_amount = token_b_in_amount
        .safe_div(U256::from(MAX_SQRT_PRICE) * U256::from(MIN_SQRT_PRICE))
        .unwrap();

    let a = u64::try_from(token_a_in_amount).unwrap();
    let init_sqrt_price = calculate_init_price(a, b, MIN_SQRT_PRICE, MAX_SQRT_PRICE).unwrap();

    println!("init_sqrt_price: {:?}", init_sqrt_price);

    let pool = Pool {
        sqrt_min_price: MIN_SQRT_PRICE,
        sqrt_max_price: MAX_SQRT_PRICE,
        sqrt_price: init_sqrt_price,
        ..Default::default()
    };

    let liquidity_delta = get_liquidity_for_adding_liquidity(
        a,
        b,
        init_sqrt_price,
        pool.sqrt_min_price,
        pool.sqrt_max_price,
    )
    .unwrap();

    let ModifyLiquidityResult {
        token_a_amount,
        token_b_amount,
    } = pool
        .get_amounts_for_modify_liquidity(liquidity_delta, cp_amm::u128x128_math::Rounding::Up)
        .unwrap();

    // The small difference in token_a is expected due to rounding in liquidity calculations
    let token_a_diff = (token_a_amount as i128 - a as i128).abs();
    assert!(
        token_a_diff <= 10, // Allow up to 10 lamport difference
        "token_a_amount difference {} is too large (got: {}, expected: {})",
        token_a_diff,
        token_a_amount,
        token_a_in_amount
    );

    // The small difference in token_b is expected due to rounding in liquidity calculations
    let token_b_diff = (token_b_amount as i128 - b as i128).abs();
    assert!(
        token_b_diff <= 10, // Allow up to 10 lamport difference
        "token_b_amount difference {} is too large (got: {}, expected: {})",
        token_b_diff,
        token_b_amount,
        token_b_in_amount
    );
}
