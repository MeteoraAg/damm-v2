use std::u128;

use proptest::proptest;

use crate::{
    constants::SCALE_OFFSET,
    state::{Pool, Position},
    u128x128_math::Rounding,
    utils_math::safe_shl_div_cast,
};
use proptest::prelude::*;
const U64_MAX: u64 = u64::MAX;
const U128_MAX: u128 = u128::MAX;
const ONE_DAY: u64 = 60 * 60 * 24;
proptest! {
    #![proptest_config(ProptestConfig {
        cases: 10000, .. ProptestConfig::default()
    })]
    #[test]
    fn test_calculate_reward_overflow(funding_amount in 1..=U64_MAX, liquidity_supply in 1..U128_MAX) {
        let mut pool = Pool {
            liquidity: liquidity_supply,
            ..Default::default()
        };
        let reward_info = &mut pool.reward_infos[0];
        reward_info.initialized = 1;
        reward_info.reward_duration = ONE_DAY;

        // update reward rate
        reward_info.update_rate_after_funding(100, funding_amount)?;

        // update pool reward
        pool.update_rewards(200)?;

        // position reward
        let mut position = Position {
            vested_liquidity: liquidity_supply,
            ..Default::default()
        };

        // position.update_rewards( &mut pool , 300)?;

        // let position_reward = &mut position.reward_infos[0];
        // position_reward.



    }
}
