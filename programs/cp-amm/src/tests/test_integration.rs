use crate::{
    base_fee::fee_time_scheduler::PodAlignedFeeTimeScheduler,
    constants::{MAX_SQRT_PRICE, MIN_SQRT_PRICE},
    get_initial_pool_information,
    params::swap::TradeDirection,
    safe_math::SafeCast,
    state::{
        fee::{BaseFeeStruct, FeeMode, PoolFeesStruct},
        CollectFeeMode, Pool, Position,
    },
    tests::{test_liquidity_compounding::get_sqrt_price_and_liquidity_from_amounts, LIQUIDITY_MAX},
    u128x128_math::Rounding,
    InitialPoolInformation, DEAD_LIQUIDITY,
};
use proptest::{bool::ANY, prelude::*};

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100, .. ProptestConfig::default()
    })]
    #[test]
    fn test_reserve_wont_loss(
        sqrt_price in MIN_SQRT_PRICE..=MAX_SQRT_PRICE,
        liquidity_delta in 1..=LIQUIDITY_MAX / 1000,
        has_referral in ANY,
        amount_in_a in 1..=u32::MAX as u64,
        amount_in_b in 1..=u32::MAX as u64,
    ) {
        let fee_scheduler = PodAlignedFeeTimeScheduler {
            cliff_fee_numerator: 1_000_000,
            ..Default::default()
        };

        let mut base_fee = BaseFeeStruct::default();
        let data = bytemuck::bytes_of(&fee_scheduler);
        base_fee.base_fee_info.data.copy_from_slice(data);

        let pool_fees = PoolFeesStruct {
            base_fee, //1%
            protocol_fee_percent: 20,
            referral_fee_percent: 20,
            ..Default::default()
        };

        let mut pool = Pool {
            pool_fees,
            sqrt_price,
            sqrt_min_price: MIN_SQRT_PRICE,
            sqrt_max_price: MAX_SQRT_PRICE,
            ..Default::default()
        };

        let mut reserve = PoolReserve::default();

        let mut position = Position::default();

        let mut swap_count = 0;
        for _i in 0..100 {
            //random action
            execute_add_liquidity(&mut reserve, &mut pool, &mut position, liquidity_delta);

            if execute_swap_liquidity(&mut reserve, &mut pool, amount_in_a, has_referral, TradeDirection::AtoB){
                swap_count += 1;
            }

            if execute_swap_liquidity(&mut reserve, &mut pool, amount_in_b, has_referral, TradeDirection::BtoA) {
                swap_count += 1;
            }


            execute_remove_liquidity(&mut reserve, &mut pool, &mut position, liquidity_delta/2);
        }

        let total_liquidity = position.unlocked_liquidity;
        execute_remove_liquidity(&mut reserve, &mut pool, &mut position, total_liquidity);

        assert!(pool.liquidity == 0);
        assert!(position.unlocked_liquidity == 0);
        assert!(position.fee_b_pending <= reserve.amount_b);
        assert!(position.fee_a_pending <= reserve.amount_a);

        println!("{:?}", reserve);
        // println!("{:?}", position);
        // println!("{:?}", pool);
        println!("swap_count {}", swap_count);
    }


    #[test]
    fn test_compounding_reserve_wont_loss(
        a in 1..u32::MAX,
        b in 1..u32::MAX,
        has_referral in ANY,
        amount_in_a in 1..=u32::MAX as u64,
        amount_in_b in 1..=u32::MAX as u64,
    ) {
        let fee_scheduler = PodAlignedFeeTimeScheduler {
            cliff_fee_numerator: 1_000_000,
            ..Default::default()
        };

        let mut base_fee = BaseFeeStruct::default();
        let data = bytemuck::bytes_of(&fee_scheduler);
        base_fee.base_fee_info.data.copy_from_slice(data);

        let pool_fees = PoolFeesStruct {
            base_fee, //1%
            protocol_fee_percent: 20,
            referral_fee_percent: 20,
            compounding_fee_bps: 5000, // 50%
            ..Default::default()
        };

        let result = get_sqrt_price_and_liquidity_from_amounts(a.into(), b.into());
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
            pool_fees,
            collect_fee_mode: CollectFeeMode::Compounding.into(),
            token_a_amount,
            token_b_amount,
            liquidity,
            ..Default::default()
        };

        let mut reserve = PoolReserve { amount_a: token_a_amount, amount_b: token_b_amount};

        let mut position = Position{unlocked_liquidity: initial_liquidity, ..Default::default()};

        let mut swap_count = 0;
        for _i in 0..100 {
            //random action
            execute_add_liquidity(&mut reserve, &mut pool, &mut position, liquidity);

            if execute_swap_liquidity(&mut reserve, &mut pool, amount_in_a, has_referral, TradeDirection::AtoB){
                swap_count += 1;
            }

            if execute_swap_liquidity(&mut reserve, &mut pool, amount_in_b, has_referral, TradeDirection::BtoA) {
                swap_count += 1;
            }


            execute_remove_liquidity(&mut reserve, &mut pool, &mut position, liquidity/2);
        }

        let total_liquidity = position.unlocked_liquidity;
        execute_remove_liquidity(&mut reserve, &mut pool, &mut position, total_liquidity);

        assert!(pool.liquidity == DEAD_LIQUIDITY);
        assert!(position.unlocked_liquidity == 0);
        assert!(position.fee_b_pending <= reserve.amount_b);
        assert!(position.fee_a_pending <= reserve.amount_a);

        println!("swap_count {} {:?}", swap_count, reserve);
        // println!("{:?}", position);
        // println!("{:?}", pool);
    }
}

#[test]
fn test_reserve_wont_lost_single() {
    let sqrt_price = 4295048016;
    let liquidity_delta = 256772808979395951;
    let has_referral = false;
    let trade_direction = false;
    let amount_in = 1;

    let fee_scheduler = PodAlignedFeeTimeScheduler {
        cliff_fee_numerator: 1_000_000,
        ..Default::default()
    };

    let mut base_fee = BaseFeeStruct::default();
    let data = bytemuck::bytes_of(&fee_scheduler);
    base_fee.base_fee_info.data.copy_from_slice(data);

    let pool_fees = PoolFeesStruct {
        base_fee, //1%
        protocol_fee_percent: 20,
        referral_fee_percent: 20,
        ..Default::default()
    };

    let mut pool = Pool {
        pool_fees,
        sqrt_price,
        sqrt_min_price: MIN_SQRT_PRICE,
        sqrt_max_price: MAX_SQRT_PRICE,
        ..Default::default()
    };

    let mut reserve = PoolReserve::default();

    let mut position = Position::default();

    let mut swap_count = 0;
    for _i in 0..100 {
        // println!("i {}", i);
        //random action
        execute_add_liquidity(&mut reserve, &mut pool, &mut position, liquidity_delta);

        if trade_direction {
            if execute_swap_liquidity(
                &mut reserve,
                &mut pool,
                amount_in,
                has_referral,
                TradeDirection::AtoB,
            ) {
                swap_count += 1;
            }
        } else {
            if execute_swap_liquidity(
                &mut reserve,
                &mut pool,
                amount_in,
                has_referral,
                TradeDirection::BtoA,
            ) {
                swap_count += 1;
            }
        }

        execute_remove_liquidity(&mut reserve, &mut pool, &mut position, liquidity_delta / 2);
    }

    let total_liquidity = position.unlocked_liquidity;
    println!(
        "swap count {} total liquidity {}",
        swap_count, total_liquidity
    );

    execute_remove_liquidity(&mut reserve, &mut pool, &mut position, total_liquidity);

    assert!(pool.liquidity == 0);
    assert!(position.unlocked_liquidity == 0);

    println!("{:?}", reserve);
    println!("{:?}", position);
    println!("{:?}", pool);
    assert!(position.fee_b_pending <= reserve.amount_b);
    assert!(position.fee_a_pending <= reserve.amount_a);
}

#[derive(Debug, Default)]
pub struct PoolReserve {
    pub amount_a: u64,
    pub amount_b: u64,
}

fn execute_add_liquidity(
    reserve: &mut PoolReserve,
    pool: &mut Pool,
    position: &mut Position,
    liquidity_delta: u128,
) {
    let liquidity_handler = pool.get_liquidity_handler().unwrap();
    let (token_a_amount, token_b_amount) = liquidity_handler
        .get_amounts_for_modify_liquidity(liquidity_delta, Rounding::Up)
        .unwrap();

    pool.apply_add_liquidity(position, liquidity_delta, token_a_amount, token_b_amount)
        .unwrap();

    reserve.amount_a = reserve.amount_a.checked_add(token_a_amount).unwrap();
    reserve.amount_b = reserve.amount_b.checked_add(token_b_amount).unwrap();
}

fn execute_remove_liquidity(
    reserve: &mut PoolReserve,
    pool: &mut Pool,
    position: &mut Position,
    liquidity_delta: u128,
) {
    let liquidity_handler = pool.get_liquidity_handler().unwrap();
    let (token_a_amount, token_b_amount) = liquidity_handler
        .get_amounts_for_modify_liquidity(liquidity_delta, Rounding::Down)
        .unwrap();

    pool.apply_remove_liquidity(position, liquidity_delta, token_a_amount, token_b_amount)
        .unwrap();

    reserve.amount_a = reserve.amount_a.checked_sub(token_a_amount).unwrap();
    reserve.amount_b = reserve.amount_b.checked_sub(token_b_amount).unwrap();
}

fn execute_swap_liquidity(
    reserve: &mut PoolReserve,
    pool: &mut Pool,
    amount_in: u64,
    has_referral: bool,
    trade_direction: TradeDirection,
) -> bool {
    let liquidity_handler = pool.get_liquidity_handler().unwrap();
    let max_amount_in = liquidity_handler
        .get_max_amount_in(trade_direction)
        .unwrap();
    if amount_in > max_amount_in {
        return false;
    }
    let collect_fee_mode: CollectFeeMode = pool.collect_fee_mode.safe_cast().unwrap();
    let fee_mode = FeeMode::get_fee_mode(collect_fee_mode, trade_direction, has_referral);

    let swap_result = pool
        .get_swap_result_from_exact_input(amount_in, &fee_mode, trade_direction, 0)
        .unwrap();

    pool.apply_swap_result(&swap_result, &fee_mode, trade_direction, 0)
        .unwrap();

    match trade_direction {
        TradeDirection::AtoB => {
            reserve.amount_a = reserve.amount_a.checked_add(amount_in).unwrap();
            reserve.amount_b = reserve
                .amount_b
                .checked_sub(swap_result.output_amount)
                .unwrap();
        }
        TradeDirection::BtoA => {
            reserve.amount_b = reserve.amount_b.checked_add(amount_in).unwrap();
            reserve.amount_a = reserve
                .amount_a
                .checked_sub(swap_result.output_amount)
                .unwrap();
        }
    }
    return true;
}
