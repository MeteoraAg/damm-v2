use crate::fee_math::get_fee_in_period;
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 100, .. ProptestConfig::default()
    })]

    #[test]
    fn fee_scheduler_exponential(
        passed_period in 1..=u16::MAX,
    ) {
        let cliff_fee_numerator: u64 = 100_000;
        let reduction_factor: u64 = 0;


        let fee_numerator: u64 = get_fee_in_period(cliff_fee_numerator, reduction_factor, passed_period)?;
        assert_eq!(fee_numerator, cliff_fee_numerator)
    }
}
