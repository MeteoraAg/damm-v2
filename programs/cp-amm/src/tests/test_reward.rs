use std::u128;

use proptest::proptest;

use anchor_lang::prelude::{Pubkey, Result};
use ruint::aliases::U256;

use crate::{
    constants::{MIN_REWARD_DURATION, REWARD_RATE_SCALE, TOTAL_REWARD_SCALE},
    state::{Pool, UserRewardInfo},
    u128x128_math::Rounding,
    utils_math::safe_shl_div_cast,
};
use proptest::prelude::*;
const U64_MAX: u64 = u64::MAX;
const PER_DAY: u64 = 60 * 60 * 12;
proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_calculate_reward_rate(funding_amount in 1..=U64_MAX) {
        let mut pool = Pool::default();
        let reward_info = &mut pool.reward_infos[0];
        reward_info.reward_duration = PER_DAY;
        // reward_info.reward_duration_end = ONE_DAY;
        reward_info.update_rate_after_funding(60 * 60 * 48, funding_amount)?;

        let expect_rate: u128 = safe_shl_div_cast(funding_amount.into(), reward_info.reward_duration.into(), REWARD_RATE_SCALE, Rounding::Down)?;
        assert!(expect_rate == reward_info.reward_rate)
    }
}

const ONE_DAY: u64 = MIN_REWARD_DURATION;

fn pool_with_full_reward_accumulator() -> Result<Pool> {
    let mut pool = Pool::default();
    pool.liquidity = 1;
    pool.reward_infos[0].init_reward(
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        Pubkey::new_unique(),
        ONE_DAY,
        0,
    );

    pool.reward_infos[0].update_rate_after_funding(0, u64::MAX)?;
    pool.update_rewards(ONE_DAY)?;

    pool.reward_infos[0].update_rate_after_funding(ONE_DAY, 1)?;
    pool.update_rewards(ONE_DAY * 2)?;

    Ok(pool)
}

#[test]
fn test_reward_accumulator_wraps_instead_of_freezing_the_pool() -> Result<()> {
    let mut pool = pool_with_full_reward_accumulator()?;
    let before_wrap = pool.reward_infos[0].reward_per_token_stored();
    // Measured headroom under U256::MAX: about 2^142.8.
    assert!(U256::MAX - before_wrap < U256::from(1u128) << 144);

    pool.liquidity = 1 << 105;

    // One more  round of funding carries the accumulator over the upper limit
    pool.reward_infos[0].update_rate_after_funding(ONE_DAY * 2, u64::MAX)?;
    pool.update_rewards(ONE_DAY * 3)?;

    assert!(pool.reward_infos[0].reward_per_token_stored() < before_wrap);
    assert_eq!(pool.reward_infos[0].last_update_time, ONE_DAY * 3);

    // continue working into the future
    pool.update_rewards(ONE_DAY * 3 + 100 * 365 * ONE_DAY)?;

    Ok(())
}

#[test]
fn test_position_reward_delta_survives_a_wrap() {
    let liquidity = 1u128;
    let growth = U256::from(1u128) << TOTAL_REWARD_SCALE; // one raw token per unit of liquidity

    let start: U256 = U256::MAX - (growth >> 1);
    let mut wrapped = UserRewardInfo::default();
    wrapped.reward_per_token_checkpoint = start.to_le_bytes();
    wrapped.update_rewards(liquidity, start.wrapping_add(growth));

    let mut unwrapped = UserRewardInfo::default();
    unwrapped.update_rewards(liquidity, growth);

    assert_eq!(wrapped.reward_pendings, unwrapped.reward_pendings);
    assert_eq!(wrapped.reward_pendings, 1);
}

#[test]
fn test_position_reward_clamps_instead_of_reverting() {
    let mut user_reward = UserRewardInfo::default();
    user_reward.update_rewards(u128::MAX, U256::MAX);
    assert_eq!(user_reward.reward_pendings, u64::MAX);

    user_reward.update_rewards(u128::MAX, U256::ZERO);
    assert_eq!(user_reward.reward_pendings, u64::MAX);
}
