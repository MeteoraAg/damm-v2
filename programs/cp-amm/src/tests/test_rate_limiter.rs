use crate::{
    base_fee::{fee_rate_limiter::PodAlignedFeeRateLimiter, BaseFeeHandler},
    state::fee::BaseFeeMode,
};

// A deprecated rate limiter with non-zero parameters, as stored by existing pools
fn deprecated_rate_limiter(cliff_fee_numerator: u64) -> PodAlignedFeeRateLimiter {
    PodAlignedFeeRateLimiter {
        cliff_fee_numerator,
        reference_amount: 1_000_000_000, // 1 SOL
        max_limiter_duration: 60,        // 60 seconds
        max_fee_bps: 5000,               // 50 %
        fee_increment_bps: 10,           // 10 bps
        base_fee_mode: BaseFeeMode::RateLimiter.into(),
        ..Default::default()
    }
}

#[test]
fn test_rate_limiter_always_charges_cliff_fee() {
    let cliff_fee_numerator = 10_000_000;
    let rate_limiter = deprecated_rate_limiter(cliff_fee_numerator);
    let activation_point = 100;

    // before, inside and after the former limiter window
    for current_point in [0, activation_point, activation_point + 30, u64::MAX] {
        let fee_numerator = rate_limiter
            .get_current_base_fee_numerator(current_point, activation_point, 0, 0)
            .unwrap();
        assert_eq!(fee_numerator, cliff_fee_numerator);
    }

    assert_eq!(
        rate_limiter.get_min_fee_numerator().unwrap(),
        cliff_fee_numerator
    );
    assert_eq!(
        rate_limiter.get_max_fee_numerator().unwrap(),
        cliff_fee_numerator
    );
}
