use std::u64;

use crate::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    curve::get_initialize_amounts,
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool},
    tests::LIQUIDITY_MAX,
};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]

    #[test]
    fn test_reserve_wont_lost_when_swap_from_a_to_b(
        sqrt_price in MIN_SQRT_PRICE..=MAX_SQRT_PRICE,
        amount_out in 1..=u64::MAX,
        liquidity in 1..=LIQUIDITY_MAX,
    ) {
        let mut pool = Pool {
            liquidity,
            sqrt_price,
            sqrt_min_price: MIN_SQRT_PRICE,
            sqrt_max_price: MAX_SQRT_PRICE,
            ..Default::default()
        };

        let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, TradeDirection::AtoB, false).unwrap();
        let max_amount_out = pool.get_max_amount_out(TradeDirection::AtoB).unwrap();
        if amount_out <= max_amount_out {
            let swap_result_forward = pool
            .get_swap_result_with_amount_out(amount_out, fee_mode, TradeDirection::AtoB, 0)
            .unwrap();

            pool.apply_swap_result(&swap_result_forward, fee_mode, 0).unwrap();
            // swap back

            let swap_result_backward = pool
            .get_swap_result_with_amount_in(swap_result_forward.output_amount, fee_mode, TradeDirection::BtoA, 0)
            .unwrap();

            assert!(swap_result_forward.output_amount == amount_out);
            assert!(swap_result_forward.input_amount > swap_result_backward.output_amount);
        }
    }

    #[test]
    fn test_reserve_wont_lost_when_swap_from_b_to_a(
        sqrt_price in MIN_SQRT_PRICE..=MAX_SQRT_PRICE,
        amount_out in 1..=u64::MAX,
        liquidity in 1..=LIQUIDITY_MAX,
    ) {
        let mut pool = Pool {
            liquidity,
            sqrt_price,
            sqrt_min_price: MIN_SQRT_PRICE,
            sqrt_max_price: MAX_SQRT_PRICE,
            ..Default::default()
        };

        let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, TradeDirection::BtoA, false).unwrap();
        let max_amount_out = pool.get_max_amount_out(TradeDirection::BtoA).unwrap();
        if amount_out <= max_amount_out {
            let swap_result_forward = pool
            .get_swap_result_with_amount_out(amount_out, fee_mode, TradeDirection::BtoA, 0)
            .unwrap();

            pool.apply_swap_result(&swap_result_forward, fee_mode, 0).unwrap();
            // swap back

            let swap_result_backward = pool
            .get_swap_result_with_amount_in(swap_result_forward.output_amount, fee_mode, TradeDirection::AtoB, 0)
            .unwrap();

            assert!(swap_result_forward.output_amount == amount_out);
            assert!(swap_result_forward.input_amount > swap_result_backward.output_amount);
        }
    }
}

#[test]
fn test_swap_basic() {
    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let sqrt_price = u64::MAX as u128;
    let liquidity = LIQUIDITY_MAX;
    let mut pool = Pool {
        ..Default::default()
    };

    let (_token_a_amount, _token_b_amount) =
        get_initialize_amounts(sqrt_min_price, sqrt_max_price, sqrt_price, liquidity).unwrap();
    pool.liquidity = liquidity;
    pool.sqrt_max_price = sqrt_max_price;
    pool.sqrt_min_price = sqrt_min_price;
    pool.sqrt_price = sqrt_price;

    let amount_out = 100_000_000;
    let trade_direction = TradeDirection::AtoB;
    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, false).unwrap();

    let swap_result_forward = pool
        .get_swap_result_with_amount_out(amount_out, fee_mode, trade_direction, 0)
        .unwrap();

    pool.apply_swap_result(&swap_result_forward, fee_mode, 0)
        .unwrap();

    let swap_result_backward = pool
        .get_swap_result_with_amount_out(
            swap_result_forward.input_amount,
            fee_mode,
            TradeDirection::BtoA,
            0,
        )
        .unwrap();

    assert!(swap_result_forward.output_amount == amount_out);
    assert!(swap_result_forward.input_amount >= swap_result_backward.output_amount);
}
