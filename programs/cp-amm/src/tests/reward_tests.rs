use std::u128;

use proptest::proptest;

use crate::{
    constants::REWARD_RATE_SCALE, state::Pool, u128x128_math::Rounding,
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
