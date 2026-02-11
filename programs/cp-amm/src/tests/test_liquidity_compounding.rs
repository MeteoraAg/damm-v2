use crate::math::safe_math::SafeMath;
use crate::params::swap::TradeDirection;
use crate::safe_math::SafeCast;
use crate::state::fee::FeeMode;
use crate::utils_math::sqrt_u256;
use crate::PoolError;
use crate::{
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    get_initial_pool_information,
    state::{CollectFeeMode, Pool, Position},
    u128x128_math::Rounding,
    InitialPoolInformation, DEAD_LIQUIDITY,
};
use crate::{CompoundingLiquidity, LiquidityHandler};
use anchor_lang::prelude::*;
use proptest::prelude::*;
use ruint::aliases::U256;
use std::u64;

pub fn get_sqrt_price_and_liquidity_from_amounts(
    initial_amount_a: u64,
    initial_amount_b: u64,
) -> Result<(u128, u128)> {
    let sqrt_price = sqrt_u256(
        U256::from(initial_amount_b)
            .safe_shl(128)
            .unwrap()
            .safe_div(U256::from(initial_amount_a))
            .unwrap(),
    )
    .unwrap();
    let sqrt_price: u128 = sqrt_price.try_into().unwrap();
    require!(
        sqrt_price >= MIN_SQRT_PRICE || sqrt_price <= MAX_SQRT_PRICE,
        PoolError::InvalidPriceRange
    );
    let liquidity = sqrt_u256(
        U256::from(initial_amount_b)
            .safe_mul(U256::from(initial_amount_a))
            .unwrap()
            .safe_shl(128)
            .unwrap(),
    )
    .unwrap();
    let liquidity: u128 = liquidity.try_into().unwrap();
    require!(
        liquidity >= DEAD_LIQUIDITY,
        PoolError::InvalidMinimumLiquidity
    );
    Ok((sqrt_price, liquidity))
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_compounding_liquidity_initialization(
        a in 1..u64::MAX,
        b in 1..u64::MAX,
    ) {
        let result = get_sqrt_price_and_liquidity_from_amounts(a, b);
        if result.is_err() {
            return Ok(());
        }
        let (sqrt_price, liquidity) = result.unwrap();
        let InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            initial_liquidity,
            sqrt_min_price: _,
            sqrt_max_price: _,
        } = get_initial_pool_information(
            CollectFeeMode::Compounding,
            0,
            0,
            sqrt_price,
            liquidity,
        ).unwrap();

        let mut pool = Pool {
            collect_fee_mode: CollectFeeMode::Compounding.into(),
            token_a_amount,
            token_b_amount,
            liquidity,
            ..Default::default()
        };

        // println!("amount {} {} {} {}",a,b, token_a_amount, token_b_amount);

        let mut position = Position{
            unlocked_liquidity: initial_liquidity,
             ..Default::default()
        };
        let unlocked_liquidity = position.unlocked_liquidity;

        let liquidity_handler = pool.get_liquidity_handler().unwrap();
        let (removed_token_a_amount, removed_token_b_amount) = liquidity_handler.get_amounts_for_modify_liquidity(unlocked_liquidity, Rounding::Down).unwrap();
        pool.apply_remove_liquidity(&mut position, unlocked_liquidity, removed_token_a_amount, removed_token_b_amount).unwrap();
        assert!(pool.liquidity > 0); // there is a deadshare in pool
        assert_eq!(position.unlocked_liquidity, 0);
    }
}

#[test]
fn test_compounding_liquidity_next_sqrt_price() {
    let liquidity_handler = CompoundingLiquidity {
        token_a_amount: 1,
        token_b_amount: u64::MAX,
        liquidity: 0,
    };
    let next_sqrt_price = liquidity_handler.get_next_sqrt_price(0).unwrap();

    println!("{}", next_sqrt_price);

    let liquidity_handler = CompoundingLiquidity {
        token_a_amount: u64::MAX,
        token_b_amount: 1,
        liquidity: 0,
    };
    let next_sqrt_price = liquidity_handler.get_next_sqrt_price(0).unwrap();

    println!("{}", next_sqrt_price);
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_compounding_liquidity_reserve_wont_lost_when_swap_from_a_to_b(
        amount_in in 1..=u64::MAX,
        a in 1..u64::MAX,
        b in 1..u64::MAX,
    ) {
        let result = get_sqrt_price_and_liquidity_from_amounts(a, b);
        if result.is_err() {
            return Ok(());
        }
        let (sqrt_price, liquidity) = result.unwrap();
        let InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            initial_liquidity:_,
            sqrt_min_price: _,
            sqrt_max_price: _,
        } = get_initial_pool_information(
            CollectFeeMode::Compounding,
            0,
            0,
            sqrt_price,
            liquidity,
        ).unwrap();

        let mut pool = Pool {
            collect_fee_mode: CollectFeeMode::Compounding.into(),
            token_a_amount,
            token_b_amount,
            liquidity,
            ..Default::default()
        };

        if u128::from(token_a_amount).safe_add(u128::from(amount_in)).unwrap() > u128::from(u64::MAX) {
            return Ok(());
        }

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
    fn test_compounding_liquidity_reserve_wont_lost_when_swap_from_b_to_a(
        amount_in in 1..=u64::MAX,
        a in 1..u64::MAX,
        b in 1..u64::MAX,
    ) {
        let result = get_sqrt_price_and_liquidity_from_amounts(a, b);
        if result.is_err() {
            return Ok(());
        }
        let (sqrt_price, liquidity) = result.unwrap();

        let InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            initial_liquidity:_,
            sqrt_min_price: _,
            sqrt_max_price: _,
        } = get_initial_pool_information(
            CollectFeeMode::Compounding,
            0,
            0,
            sqrt_price,
            liquidity,
        ).unwrap();

        let mut pool = Pool {
            collect_fee_mode: CollectFeeMode::Compounding.into(),
            token_a_amount,
            token_b_amount,
            liquidity,
            ..Default::default()
        };

        if u128::from(token_b_amount).safe_add(u128::from(amount_in)).unwrap() > u128::from(u64::MAX) {
            return Ok(());
        }

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
fn test_compounding_swap_basic() {
    let a = 100_000_000;
    let b = 100_000_000_000;
    let (sqrt_price, liquidity) = get_sqrt_price_and_liquidity_from_amounts(a, b).unwrap();

    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        initial_liquidity: _,
        sqrt_min_price: _,
        sqrt_max_price: _,
    } = get_initial_pool_information(CollectFeeMode::Compounding, 0, 0, sqrt_price, liquidity)
        .unwrap();

    let mut pool = Pool {
        collect_fee_mode: CollectFeeMode::Compounding.into(),
        token_a_amount,
        token_b_amount,
        liquidity,
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
