use crate::{
    activation_handler::ActivationType,
    base_fee::{fee_rate_limiter::PodAlignedFeeRateLimiter, BaseFeeHandler},
    constants::fee::{FEE_DENOMINATOR, MIN_FEE_NUMERATOR},
    params::fee_parameters::to_numerator,
    state::{fee::BaseFeeMode, CollectFeeMode},
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

#[test]
fn test_validate_rate_limiter_accepts_any_parameters() {
    // fix_pool_fee_params and fix_config_fee_params only change parameters that fail validate,
    // so validate must pass for every stored rate limiter to keep them out of reach
    let max_fee_numerator = to_numerator(5000, FEE_DENOMINATOR.into()).unwrap();

    for collect_fee_mode in [CollectFeeMode::BothToken, CollectFeeMode::OnlyB] {
        for activation_type in [ActivationType::Slot, ActivationType::Timestamp] {
            for cliff_fee_numerator in [0, MIN_FEE_NUMERATOR, max_fee_numerator + 1, u64::MAX] {
                assert!(deprecated_rate_limiter(cliff_fee_numerator)
                    .validate(collect_fee_mode, activation_type)
                    .is_ok());
            }
        }
    }
}
