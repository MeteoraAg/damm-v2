use std::{u128, u64};

use crate::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    params::swap::TradeDirection,
    safe_math::{SafeCast, SafeMath},
    state::{fee::FeeMode, CollectFeeMode, Pool},
    tests::LIQUIDITY_MAX,
    ConcenstratedLiquidity, InitialPoolInformation,
};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_reserve_wont_lost_when_swap_from_a_to_b(
        sqrt_price in MIN_SQRT_PRICE..=MAX_SQRT_PRICE,
        amount_in in 1..=u64::MAX,
        liquidity in 1..=LIQUIDITY_MAX,
    ) {

        let sqrt_min_price = MIN_SQRT_PRICE;
        let sqrt_max_price = MAX_SQRT_PRICE;
        let InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            initial_liquidity: _,
            sqrt_min_price,
            sqrt_max_price,
        } = ConcenstratedLiquidity::get_initial_pool_information(
            sqrt_min_price,
            sqrt_max_price,
            sqrt_price,
            liquidity,
        )
        .unwrap();

        let mut pool = Pool {
            liquidity,
            sqrt_max_price,
            sqrt_min_price,
            sqrt_price,
            token_a_amount,
            token_b_amount,
            ..Default::default()
        };

        let trade_direction = TradeDirection::AtoB;

        let collect_fee_mode: CollectFeeMode = pool.collect_fee_mode.safe_cast().unwrap();
        let fee_mode = FeeMode::get_fee_mode(collect_fee_mode, trade_direction, false);

        let liquidity_handler = pool.get_liquidity_handler().unwrap();
        let max_amount_in = liquidity_handler.get_max_amount_in(trade_direction).unwrap();
        if amount_in <= max_amount_in {
            let swap_result_0 = pool
            .get_swap_result_from_exact_input(amount_in, &fee_mode, trade_direction, 0)
            .unwrap();

            pool.apply_swap_result(&swap_result_0, &fee_mode, trade_direction, 0).unwrap();
            // swap back

            let swap_result_1 = pool
            .get_swap_result_from_exact_input(swap_result_0.output_amount, &fee_mode, TradeDirection::BtoA, 0)
            .unwrap();

            assert!(swap_result_1.output_amount < amount_in);
        }

    }


    #[test]
    fn test_reserve_wont_lost_when_swap_from_b_to_a(
        sqrt_price in MIN_SQRT_PRICE..=MAX_SQRT_PRICE,
        amount_in in 1..=u64::MAX,
        liquidity in 1..=LIQUIDITY_MAX,
    ) {
        let sqrt_min_price = MIN_SQRT_PRICE;
        let sqrt_max_price = MAX_SQRT_PRICE;
        let InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            initial_liquidity: _,
            sqrt_min_price,
            sqrt_max_price,
        } = ConcenstratedLiquidity::get_initial_pool_information(
            sqrt_min_price,
            sqrt_max_price,
            sqrt_price,
            liquidity,
        )
        .unwrap();

        let mut pool = Pool {
            liquidity,
            sqrt_max_price,
            sqrt_min_price,
            sqrt_price,
            token_a_amount,
            token_b_amount,
            ..Default::default()
        };

        let trade_direction = TradeDirection::BtoA;

        let collect_fee_mode: CollectFeeMode = pool.collect_fee_mode.safe_cast().unwrap();
        let fee_mode = FeeMode::get_fee_mode(collect_fee_mode, trade_direction, false);

        let liquidity_handler = pool.get_liquidity_handler().unwrap();
        let max_amount_in = liquidity_handler.get_max_amount_in(trade_direction).unwrap();
        if amount_in <= max_amount_in {
            let swap_result_0 = pool
            .get_swap_result_from_exact_input(amount_in, &fee_mode, trade_direction, 0)
            .unwrap();

            pool.apply_swap_result(&swap_result_0, &fee_mode, trade_direction, 0).unwrap();
            // swap back

            let swap_result_1 = pool
            .get_swap_result_from_exact_input(swap_result_0.output_amount, &fee_mode, TradeDirection::AtoB, 0)
            .unwrap();

            assert!(swap_result_1.output_amount < amount_in);
        }
    }

}

#[test]
fn test_reserve_wont_lost_when_swap_from_b_to_a_single() {
    let liquidity = LIQUIDITY_MAX;
    let sqrt_price = 19163436944492510497018124036;
    let amount_in = 1_000_0000;
    let trade_direction = TradeDirection::BtoA;

    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        initial_liquidity: _,
        sqrt_min_price,
        sqrt_max_price,
    } = ConcenstratedLiquidity::get_initial_pool_information(
        sqrt_min_price,
        sqrt_max_price,
        sqrt_price,
        liquidity,
    )
    .unwrap();

    let mut pool = Pool {
        liquidity,
        sqrt_max_price,
        sqrt_min_price,
        sqrt_price,
        token_a_amount,
        token_b_amount,
        ..Default::default()
    };

    let collect_fee_mode: CollectFeeMode = pool.collect_fee_mode.safe_cast().unwrap();
    let fee_mode = FeeMode::get_fee_mode(collect_fee_mode, trade_direction, false);

    let swap_result_0 = pool
        .get_swap_result_from_exact_input(amount_in, &fee_mode, trade_direction, 0)
        .unwrap();

    println!("{:?}", swap_result_0);

    pool.apply_swap_result(&swap_result_0, &fee_mode, trade_direction, 0)
        .unwrap();

    let swap_result_1 = pool
        .get_swap_result_from_exact_input(
            swap_result_0.output_amount,
            &fee_mode,
            TradeDirection::AtoB,
            0,
        )
        .unwrap();

    println!("{:?}", swap_result_1);

    assert!(swap_result_1.output_amount < amount_in);
}

#[test]
fn test_swap_basic() {
    let sqrt_min_price = MIN_SQRT_PRICE;
    let sqrt_max_price = MAX_SQRT_PRICE;
    let sqrt_price = u64::MAX as u128;
    let liquidity = LIQUIDITY_MAX;

    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        initial_liquidity: _,
        sqrt_min_price,
        sqrt_max_price,
    } = ConcenstratedLiquidity::get_initial_pool_information(
        sqrt_min_price,
        sqrt_max_price,
        sqrt_price,
        liquidity,
    )
    .unwrap();

    let mut pool = Pool {
        liquidity,
        sqrt_max_price,
        sqrt_min_price,
        sqrt_price,
        token_a_amount,
        token_b_amount,
        ..Default::default()
    };

    let amount_in = 100_000_000;
    let trade_direction = TradeDirection::AtoB;

    let collect_fee_mode: CollectFeeMode = pool.collect_fee_mode.safe_cast().unwrap();
    let fee_mode = FeeMode::get_fee_mode(collect_fee_mode, trade_direction, false);

    let swap_result = pool
        .get_swap_result_from_exact_input(amount_in, &fee_mode, trade_direction, 0)
        .unwrap();

    println!("result {:?}", swap_result);

    pool.apply_swap_result(&swap_result, &fee_mode, trade_direction, 0)
        .unwrap();

    let swap_result_referse = pool
        .get_swap_result_from_exact_input(
            swap_result.output_amount,
            &fee_mode,
            TradeDirection::BtoA,
            0,
        )
        .unwrap();

    println!("reverse {:?}", swap_result_referse);
    assert!(swap_result_referse.output_amount <= amount_in);
}

#[test]
fn test_basic_math() {
    let liquidity = LIQUIDITY_MAX;
    let quote_1 = liquidity.safe_shr(64).unwrap();
    let quote_2 = liquidity.safe_div(1.safe_shl(64).unwrap()).unwrap();
    assert_eq!(quote_1, quote_2);
}
