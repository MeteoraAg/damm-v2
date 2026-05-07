use proptest::prelude::*;

use crate::{
    constants::SPLIT_POSITION_DENOMINATOR,
    state::{InnerVesting, Pool, Position},
};

fn build_position(
    cliff_point: u64,
    period_frequency: u64,
    number_of_period: u16,
    cliff_unlock_liquidity: u128,
    liquidity_per_period: u128,
    current_point: u16,
    end_point: u16,
) -> Position {
    let total_release_liquidity_at_current_point =
        cliff_unlock_liquidity + u128::from(current_point) * liquidity_per_period;

    let total_release_liquidity_at_end_point =
        cliff_unlock_liquidity + u128::from(end_point) * liquidity_per_period;

    let inner_vesting = InnerVesting {
        cliff_point,
        period_frequency,
        number_of_period,
        cliff_unlock_liquidity,
        liquidity_per_period,
        total_released_liquidity: total_release_liquidity_at_current_point,
        ..Default::default()
    };

    let mut position = Position::default();
    position.vested_liquidity =
        total_release_liquidity_at_end_point - total_release_liquidity_at_current_point;
    position.unlocked_liquidity = total_release_liquidity_at_current_point;
    position.inner_vesting = inner_vesting;

    position
}

#[allow(clippy::too_many_arguments)]
fn run_test_inner_vesting_split(
    current_point: u16,
    vesting_end_point: u16,
    idx_pct_between_points: u16,
    cliff_unlock_liquidity_0: u64,
    liquidity_per_period_0: u64,
    split_numerator: u32,
) {
    let period_frequency = 1;
    let cliff_point = 0;
    let number_of_period = vesting_end_point;

    let mut position_0 = build_position(
        cliff_point,
        period_frequency,
        number_of_period,
        cliff_unlock_liquidity_0.into(),
        liquidity_per_period_0.into(),
        current_point,
        vesting_end_point,
    );

    let mut position_1 = Position::default();

    let prev_vesting_0 = position_0.inner_vesting;
    let prev_vesting_1 = position_1.inner_vesting;

    let total_vested_liquidity = prev_vesting_0
        .get_max_unlocked_liquidity(vesting_end_point.into())
        .unwrap();

    let pool = Pool::default();

    let p0_prev_total_vested_liquidity = position_0.vested_liquidity;
    let p1_prev_total_vested_liquidity = position_1.vested_liquidity;

    pool.apply_split_position(
        &mut position_0,
        &mut position_1,
        0,
        0,
        0,
        0,
        0,
        0,
        split_numerator,
        current_point.into(),
    )
    .unwrap();

    assert!(p0_prev_total_vested_liquidity >= position_0.vested_liquidity);
    assert!(position_1.vested_liquidity >= p1_prev_total_vested_liquidity);

    assert!(
        position_0.inner_vesting.cliff_unlock_liquidity <= prev_vesting_0.cliff_unlock_liquidity
    );
    assert!(
        position_1.inner_vesting.cliff_unlock_liquidity >= prev_vesting_1.cliff_unlock_liquidity
    );

    assert!(position_0.inner_vesting.liquidity_per_period <= prev_vesting_0.liquidity_per_period);
    assert!(position_1.inner_vesting.liquidity_per_period >= prev_vesting_1.liquidity_per_period);

    assert!(
        position_0.inner_vesting.total_released_liquidity
            <= prev_vesting_0.total_released_liquidity
    );
    assert!(
        position_1.inner_vesting.total_released_liquidity
            >= prev_vesting_1.total_released_liquidity
    );

    let point_increment =
        u32::from(vesting_end_point - current_point) * u32::from(idx_pct_between_points) / 100;
    let period_increment = u16::try_from(point_increment).unwrap();

    let future_point = current_point + period_increment;

    let p0_vesting_before_refresh = position_0.inner_vesting;
    let p1_vesting_before_refresh = position_1.inner_vesting;

    position_0
        .refresh_inner_vesting(future_point.into())
        .unwrap();

    position_1
        .refresh_inner_vesting(future_point.into())
        .unwrap();

    assert!(
        position_0.inner_vesting.total_released_liquidity
            >= p0_vesting_before_refresh.total_released_liquidity
    );
    assert!(
        position_1.inner_vesting.total_released_liquidity
            >= p1_vesting_before_refresh.total_released_liquidity
    );

    position_0
        .refresh_inner_vesting(vesting_end_point.into())
        .unwrap();

    position_1
        .refresh_inner_vesting(vesting_end_point.into())
        .unwrap();

    assert!(position_0.vested_liquidity == 0 && position_1.vested_liquidity == 0);
    assert!(
        position_0.unlocked_liquidity + position_1.unlocked_liquidity == total_vested_liquidity
    );
}

proptest! {
    // Default is 256
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn test_inner_vesting_split(
        current_point in 1u16..100u16,
        vesting_end_point in 100u16..200u16,
        idx in 0u16..100u16,
        cliff_unlock_liquidity in 1..u64::MAX,
        liquidity_per_period in 1..u64::MAX,
        split_numerator in 1_000u32..SPLIT_POSITION_DENOMINATOR,
    ) {
        run_test_inner_vesting_split(
            current_point,
            vesting_end_point,
            idx,
            cliff_unlock_liquidity,
            liquidity_per_period,
            split_numerator,
        );
    }
}
