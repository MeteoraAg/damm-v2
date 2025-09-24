use crate::base_fee::base_fee_serde::BaseFeeSerde;
use crate::base_fee::{FeeMarketCapScheduler, FeeTimeScheduler, FeeTimeSchedulerMode};
use crate::constants::MIN_SQRT_PRICE;
use crate::state::fee::{BaseFeeMode, BaseFeeStruct};
use crate::{base_fee::FeeRateLimiter, params::fee_parameters::BaseFeeParameters};
#[test]
fn test_base_fee_serde_rate_limiter() {
    let fee = FeeRateLimiter {
        cliff_fee_numerator: 1_000_000,
        fee_increment_bps: 20,
        max_limiter_duration: 300,
        max_fee_bps: 4000,
        reference_amount: 5_000_000_000,
    };

    // convert to base fee params
    let base_fee_params = BaseFeeParameters {
        data: fee.to_base_fee_parameters_data(),
    };
    assert!(base_fee_params.to_fee_time_scheduler().is_err());
    assert!(base_fee_params.to_fee_market_cap_scheduler(0).is_err());

    // convert back
    let reverse_fee = base_fee_params.to_fee_rate_limiter().unwrap();
    assert_eq!(fee, reverse_fee);

    // convert to base fee struct
    let base_fee_struct = BaseFeeStruct {
        data: fee.to_base_fee_struct_data(),
        ..Default::default()
    };
    assert!(base_fee_struct.to_fee_time_scheduler().is_err());
    assert!(base_fee_struct.to_fee_market_cap_scheduler(0).is_err());
    let reverse_fee = base_fee_struct.to_fee_rate_limiter().unwrap();
    assert_eq!(fee, reverse_fee);

    // convert between base fee params and base fee struct
    let reverse_base_fee_struct_data = base_fee_params.to_base_fee_struct_data();
    assert_eq!(reverse_base_fee_struct_data, base_fee_struct.data);

    let reverse_base_params_data = base_fee_struct.to_base_fee_parameters_data();
    assert_eq!(reverse_base_params_data, base_fee_params.data);
}

#[test]
fn test_base_fee_serde_time_scheduler() {
    let fee = FeeTimeScheduler {
        cliff_fee_numerator: 1_000_000,
        number_of_period: 20,
        period_frequency: 300,
        reduction_factor: 271,
        fee_scheduler_mode: FeeTimeSchedulerMode::Exponential.into(),
    };

    // convert to base fee params
    let base_fee_params = BaseFeeParameters {
        data: fee.to_base_fee_parameters_data(),
    };
    assert!(base_fee_params.to_fee_rate_limiter().is_err());
    assert!(base_fee_params.to_fee_market_cap_scheduler(0).is_err());

    // convert back
    let reverse_fee = base_fee_params.to_fee_time_scheduler().unwrap();
    assert_eq!(fee, reverse_fee);

    // convert to base fee struct
    let base_fee_struct = BaseFeeStruct {
        data: fee.to_base_fee_struct_data(),
        ..Default::default()
    };
    assert!(base_fee_struct.to_fee_rate_limiter().is_err());
    assert!(base_fee_struct.to_fee_market_cap_scheduler(0).is_err());
    let reverse_fee = base_fee_struct.to_fee_time_scheduler().unwrap();
    assert_eq!(fee, reverse_fee);

    // convert between base fee params and base fee struct
    let reverse_base_fee_struct_data = base_fee_params.to_base_fee_struct_data();
    assert_eq!(reverse_base_fee_struct_data, base_fee_struct.data);

    let reverse_base_params_data = base_fee_struct.to_base_fee_parameters_data();
    assert_eq!(reverse_base_params_data, base_fee_params.data);
}

#[test]
fn test_base_fee_serde_market_cap_scheduler() {
    let min_sqrt_price_index = 300u64;
    let max_sqrt_price_index = 1000u64;
    let min_sqrt_price = MIN_SQRT_PRICE
        .checked_mul(min_sqrt_price_index.into())
        .unwrap();
    let max_sqrt_price = MIN_SQRT_PRICE
        .checked_mul(max_sqrt_price_index.into())
        .unwrap();
    let fee = FeeMarketCapScheduler {
        cliff_fee_numerator: 1_000_000,
        min_sqrt_price,
        max_sqrt_price,
        max_sqrt_price_delta_vbps: 350,
        reduction_factor: 271,
        scheduler_expiration_duration: 300,
        fee_scheduler_mode: BaseFeeMode::FeeMarketCapSchedulerExponential.into(),
    };

    // convert to base fee params
    let base_fee_params = BaseFeeParameters {
        data: fee.to_base_fee_parameters_data(),
    };

    assert!(base_fee_params.to_fee_rate_limiter().is_err());
    assert!(base_fee_params.to_fee_time_scheduler().is_err());

    // convert back
    let reverse_fee = base_fee_params
        .to_fee_market_cap_scheduler(min_sqrt_price_index)
        .unwrap();
    assert_eq!(fee, reverse_fee);

    // convert to base fee struct
    let base_fee_struct = BaseFeeStruct {
        data: fee.to_base_fee_struct_data(),
        ..Default::default()
    };

    assert!(base_fee_struct.to_fee_rate_limiter().is_err());
    assert!(base_fee_struct.to_fee_time_scheduler().is_err());
    let reverse_fee = base_fee_struct
        .to_fee_market_cap_scheduler(min_sqrt_price_index)
        .unwrap();
    assert_eq!(fee, reverse_fee);

    // convert between base fee params and base fee struct
    let reverse_base_fee_struct_data = base_fee_params.to_base_fee_struct_data();
    assert_eq!(reverse_base_fee_struct_data, base_fee_struct.data);

    let reverse_base_params_data = base_fee_struct.to_base_fee_parameters_data();
    assert_eq!(reverse_base_params_data, base_fee_params.data);
}
