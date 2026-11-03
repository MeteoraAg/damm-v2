use std::u128;

use proptest::proptest;

use anchor_lang::prelude::{Pubkey, Result};
use ruint::aliases::U256;

use crate::{
    constants::{LIQUIDITY_SCALE, MIN_REWARD_DURATION, REWARD_RATE_SCALE, TOTAL_REWARD_SCALE},
    state::{calculate_position_fee_or_reward, Pool, UserRewardInfo},
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
fn test_position_reward_delta_survives_a_wrap() -> Result<()> {
    let liquidity = 1u128;
    let growth = U256::from(1u128) << TOTAL_REWARD_SCALE; // one raw token per unit of liquidity

    let start: U256 = U256::MAX - (growth >> 1);
    let mut wrapped = UserRewardInfo::default();
    wrapped.reward_per_token_checkpoint = start.to_le_bytes();
    wrapped.update_rewards(liquidity, start.wrapping_add(growth))?;

    let mut unwrapped = UserRewardInfo::default();
    unwrapped.update_rewards(liquidity, growth)?;

    assert_eq!(wrapped.reward_pendings, unwrapped.reward_pendings);
    assert_eq!(wrapped.reward_pendings, 1);

    Ok(())
}

#[test]
fn test_position_reward_clamps_instead_of_reverting() -> Result<()> {
    // 2^64 raw tokens, above u64::MAX but still within u128
    let liquidity = 1u128 << 64;
    let mut user_reward = UserRewardInfo::default();
    user_reward.update_rewards(liquidity, U256::from(1u128) << TOTAL_REWARD_SCALE)?;
    assert_eq!(user_reward.reward_pendings, u64::MAX);

    user_reward.update_rewards(liquidity, U256::ZERO)?;
    assert_eq!(user_reward.reward_pendings, u64::MAX);

    Ok(())
}

#[test]
fn test_position_reward_clamps_at_the_upper_extreme() -> Result<()> {
    // U384 holds the product exactly (128 + 256 bits), so no intermediate overflow is
    // left to fail on: even the largest possible inputs clamp rather than revert.
    // This matters because `update_rewards` sits on the `remove_liquidity` path, where
    // an error would lock an LP out of their principal.
    let mut user_reward = UserRewardInfo::default();
    user_reward.update_rewards(u128::MAX, U256::MAX)?;
    assert_eq!(user_reward.reward_pendings, u64::MAX);

    Ok(())
}

#[test]
fn test_calculate_position_fee_or_reward_shifts_right() -> Result<()> {
    // Pins the shift direction: a delta of one raw token per unit of liquidity must
    // come back as exactly `liquidity`, for both the fee and the reward scale.
    for offset in [LIQUIDITY_SCALE, TOTAL_REWARD_SCALE] {
        let one_per_liquidity = U256::from(1u128) << offset;

        assert_eq!(
            calculate_position_fee_or_reward(0, one_per_liquidity, offset)?,
            0
        );
        assert_eq!(
            calculate_position_fee_or_reward(1, one_per_liquidity, offset)?,
            1
        );
        assert_eq!(
            calculate_position_fee_or_reward(1_000_000, one_per_liquidity, offset)?,
            1_000_000
        );

        // rounds down: one wei short of a whole token per unit of liquidity yields nothing
        let just_under = one_per_liquidity - U256::from(1u128);
        assert_eq!(calculate_position_fee_or_reward(1, just_under, offset)?, 0);

        // and clamps once the product no longer fits u64
        let over = U256::from(1u128) << (offset + 1);
        assert_eq!(
            calculate_position_fee_or_reward(u128::MAX, over, offset)?,
            u64::MAX
        );
    }

    Ok(())
}
