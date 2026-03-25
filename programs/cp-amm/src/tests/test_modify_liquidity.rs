use crate::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    get_initial_pool_information,
    state::{CollectFeeMode, Pool, Position},
    tests::LIQUIDITY_MAX,
    u128x128_math::Rounding,
    CompoundingLiquidity, InitialPoolInformation, LiquidityHandler,
};
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_modify_liquidit_wont_loss(
        sqrt_price in MIN_SQRT_PRICE..=MAX_SQRT_PRICE,
        liquidity_delta in 1..=LIQUIDITY_MAX,
    ) {
        let mut pool = Pool {
            sqrt_price,
            sqrt_min_price: MIN_SQRT_PRICE,
            sqrt_max_price: MAX_SQRT_PRICE,
            ..Default::default()
        };

        let mut position = Position::default();

        let liquidity_handler = pool.get_liquidity_handler().unwrap();
        let result_0 = liquidity_handler
            .get_amounts_for_modify_liquidity(liquidity_delta, Rounding::Up)
            .unwrap();

        println!("result_0 {:?}", result_0);
        pool.apply_add_liquidity(&mut position, liquidity_delta, result_0.0, result_0.1).unwrap();


        let liquidity_handler = pool.get_liquidity_handler().unwrap();
        let result_1 = liquidity_handler.get_amounts_for_modify_liquidity(liquidity_delta, Rounding::Down).unwrap();
        println!("result_1 {:?}", result_1);

        pool.apply_remove_liquidity(&mut position, liquidity_delta, result_1.0, result_1.1).unwrap();

        assert_eq!(pool.liquidity, 0);
        assert_eq!(position.unlocked_liquidity, 0);

        assert!(result_0.0 >= result_1.0);
        assert!(result_0.1 >= result_1.1);
    }
}

#[test]
fn test_compounding_modify_liquidity_syncs_sqrt_price_from_reserves() {
    let (sqrt_price, liquidity) =
        super::test_liquidity_compounding::get_sqrt_price_and_liquidity_from_amounts(
            100_000_000,
            100_000_000_000,
        )
        .unwrap();

    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        initial_liquidity,
        ..
    } = get_initial_pool_information(CollectFeeMode::Compounding, 0, 0, sqrt_price, liquidity)
        .unwrap();

    let mut pool = Pool {
        collect_fee_mode: CollectFeeMode::Compounding.into(),
        token_a_amount,
        token_b_amount,
        liquidity,
        sqrt_price,
        ..Default::default()
    };
    let mut position = Position {
        unlocked_liquidity: initial_liquidity,
        ..Default::default()
    };

    let add_delta = 1u128;
    let (add_a, add_b) = pool
        .get_liquidity_handler()
        .unwrap()
        .get_amounts_for_modify_liquidity(add_delta, Rounding::Up)
        .unwrap();
    let sqrt_before_add = pool.sqrt_price;
    let expected_after_add = CompoundingLiquidity {
        token_a_amount: pool.token_a_amount + add_a,
        token_b_amount: pool.token_b_amount + add_b,
        liquidity: pool.liquidity + add_delta,
    }
    .get_next_sqrt_price(sqrt_before_add)
    .unwrap();

    pool.apply_add_liquidity(&mut position, add_delta, add_a, add_b)
        .unwrap();
    assert_eq!(pool.sqrt_price, expected_after_add);

    let remove_delta = add_delta;
    let (remove_a, remove_b) = pool
        .get_liquidity_handler()
        .unwrap()
        .get_amounts_for_modify_liquidity(remove_delta, Rounding::Down)
        .unwrap();
    let sqrt_before_remove = pool.sqrt_price;
    let expected_after_remove = CompoundingLiquidity {
        token_a_amount: pool.token_a_amount - remove_a,
        token_b_amount: pool.token_b_amount - remove_b,
        liquidity: pool.liquidity - remove_delta,
    }
    .get_next_sqrt_price(sqrt_before_remove)
    .unwrap();

    pool.apply_remove_liquidity(&mut position, remove_delta, remove_a, remove_b)
        .unwrap();
    assert_eq!(pool.sqrt_price, expected_after_remove);
}
