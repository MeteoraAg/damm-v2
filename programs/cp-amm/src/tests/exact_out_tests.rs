use std::{u128, u64};

use crate::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    params::swap::TradeDirection,
    state::Pool,
    tests::LIQUIDITY_MAX,
};
#[test]
fn test_swap_exact_out_a_to_b_fee_on_both() {
    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let sqrt_price = u64::MAX as u128;
    let liquidity = LIQUIDITY_MAX;
    let mut pool = Pool {
        // pool_fees,
        ..Default::default()
    };
    pool.liquidity = liquidity;
    pool.sqrt_max_price = sqrt_max_price;
    pool.sqrt_min_price = sqrt_min_price;
    pool.sqrt_price = sqrt_price;

    let amount_exact_out = 100_000_000;

    let is_referral = false;
    let a_to_b = TradeDirection::AtoB;
    let swap_result = pool
        .get_swap_result(amount_exact_out, is_referral, a_to_b, 0, true)
        .unwrap();

    println!("result a to b {:?}", swap_result);

    // return;

    pool.apply_swap_result(&swap_result, a_to_b, 0).unwrap();

    let swap_result_referse = pool
        .get_swap_result(
            swap_result.output_amount,
            is_referral,
            TradeDirection::BtoA,
            0,
            true,
        )
        .unwrap();

    println!("reverse {:?}", swap_result_referse);
    // exact out amount in result equal amount_exact_out
    assert!(swap_result_referse.output_amount == amount_exact_out);
}

#[test]
fn test_swap_exact_out_a_to_b_fee_on_b() {
    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let sqrt_price = u64::MAX as u128;
    let liquidity = LIQUIDITY_MAX;
    let mut pool = Pool {
        // pool_fees,
        ..Default::default()
    };
    pool.liquidity = liquidity;
    pool.sqrt_max_price = sqrt_max_price;
    pool.sqrt_min_price = sqrt_min_price;
    pool.sqrt_price = sqrt_price;
    pool.collect_fee_mode = 1; // onlyB

    let amount_exact_out = 100_000_000;

    let is_referral = false;
    let a_to_b = TradeDirection::AtoB;
    let swap_result = pool
        .get_swap_result(amount_exact_out, is_referral, a_to_b, 0, true)
        .unwrap();

    println!("result a to b {:?}", swap_result);

    // return;

    pool.apply_swap_result(&swap_result, a_to_b, 0).unwrap();

    let swap_result_referse = pool
        .get_swap_result(
            swap_result.output_amount,
            is_referral,
            TradeDirection::BtoA,
            0,
            true,
        )
        .unwrap();

    println!("reverse {:?}", swap_result_referse);
    // exact out amount in result equal amount_exact_out
    assert!(swap_result_referse.output_amount == amount_exact_out);
}

#[test]
fn test_swap_exact_out_b_to_a_fee_on_both() {
    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let sqrt_price = u64::MAX as u128;
    let liquidity = LIQUIDITY_MAX;
    let mut pool = Pool {
        // pool_fees,
        ..Default::default()
    };
    pool.liquidity = liquidity;
    pool.sqrt_max_price = sqrt_max_price;
    pool.sqrt_min_price = sqrt_min_price;
    pool.sqrt_price = sqrt_price;

    let amount_exact_out = 100_000_000;

    let is_referral = false;
    let b_to_a = TradeDirection::BtoA;
    let swap_result = pool
        .get_swap_result(amount_exact_out, is_referral, b_to_a, 0, true)
        .unwrap();

    println!("result a to b {:?}", swap_result);

    // return;

    pool.apply_swap_result(&swap_result, b_to_a, 0).unwrap();

    let swap_result_referse = pool
        .get_swap_result(
            swap_result.output_amount,
            is_referral,
            TradeDirection::BtoA,
            0,
            true,
        )
        .unwrap();

    println!("reverse {:?}", swap_result_referse);
    // exact out amount in result equal amount_exact_out
    assert!(swap_result_referse.output_amount == amount_exact_out);
}

#[test]
fn test_swap_exact_out_b_to_a_fee_on_b() {
    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let sqrt_price = u64::MAX as u128;
    let liquidity = LIQUIDITY_MAX;
    let mut pool = Pool {
        // pool_fees,
        ..Default::default()
    };
    pool.liquidity = liquidity;
    pool.sqrt_max_price = sqrt_max_price;
    pool.sqrt_min_price = sqrt_min_price;
    pool.sqrt_price = sqrt_price;
    pool.collect_fee_mode = 1; // onlyB

    let amount_exact_out = 100_000_000;

    let is_referral = false;
    let b_to_a = TradeDirection::BtoA;
    let swap_result = pool
        .get_swap_result(amount_exact_out, is_referral, b_to_a, 0, true)
        .unwrap();

    println!("result a to b {:?}", swap_result);

    // return;

    pool.apply_swap_result(&swap_result, b_to_a, 0).unwrap();

    let swap_result_referse = pool
        .get_swap_result(
            swap_result.output_amount,
            is_referral,
            TradeDirection::BtoA,
            0,
            true,
        )
        .unwrap();

    println!("reverse {:?}", swap_result_referse);
    // exact out amount in result equal amount_exact_out
    assert!(swap_result_referse.output_amount == amount_exact_out);
}
