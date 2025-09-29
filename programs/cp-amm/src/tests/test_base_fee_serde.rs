use crate::base_fee::fee_market_cap_scheduler::{
    BorshFeeMarketCapScheduler, PodAlignedFeeMarketCapScheduler,
};
use crate::base_fee::fee_rate_limiter::{BorshFeeRateLimiter, PodAlignedFeeRateLimiter};
use crate::base_fee::fee_time_scheduler::BorshFeeTimeScheduler;
use crate::base_fee::fee_time_scheduler::PodAlignedFeeTimeScheduler;
use crate::base_fee::{
    base_fee_info_to_base_fee_parameters, base_fee_parameters_to_base_fee_info, BaseFeeEnumReader,
};
use crate::params::fee_parameters::BaseFeeParameters;
use crate::state::fee::BaseFeeMode;
use anchor_lang::prelude::borsh;
use anchor_lang::{AnchorDeserialize, AnchorSerialize};
#[test]
fn test_base_fee_serde_rate_limiter() {
    let fee = BorshFeeRateLimiter {
        cliff_fee_numerator: 1_000_000,
        fee_increment_bps: 20,
        max_limiter_duration: 300,
        max_fee_bps: 4000,
        reference_amount: 5_000_000_000,
        base_fee_mode: BaseFeeMode::RateLimiter.into(),
        ..Default::default()
    };

    // convert to base fee params
    let mut base_fee_params = BaseFeeParameters::default();
    let bytes = fee.try_to_vec().unwrap();
    base_fee_params.data.copy_from_slice(&bytes);

    assert!(BorshFeeRateLimiter::try_from_slice(&base_fee_params.data).is_ok());
    assert!(BorshFeeMarketCapScheduler::try_from_slice(&base_fee_params.data).is_ok());
    assert!(BorshFeeTimeScheduler::try_from_slice(&base_fee_params.data).is_ok());

    let deserialized = BorshFeeRateLimiter::try_from_slice(&base_fee_params.data).unwrap();
    assert_eq!(fee, deserialized);

    // convert to base fee struct
    let base_fee_info_struct = base_fee_parameters_to_base_fee_info(&base_fee_params);
    assert!(base_fee_info_struct.is_ok());

    let base_fee_info_struct = base_fee_info_struct.unwrap();

    assert!(bytemuck::try_from_bytes::<PodAlignedFeeRateLimiter>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());
    assert!(bytemuck::try_from_bytes::<PodAlignedFeeMarketCapScheduler>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());
    assert!(bytemuck::try_from_bytes::<PodAlignedFeeTimeScheduler>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());

    let deserialized =
        *bytemuck::from_bytes::<PodAlignedFeeRateLimiter>(base_fee_info_struct.data.as_slice());
    assert_eq!(fee.base_fee_mode, deserialized.base_fee_mode);
    assert_eq!(fee.cliff_fee_numerator, deserialized.cliff_fee_numerator);
    assert_eq!(fee.fee_increment_bps, deserialized.fee_increment_bps);
    assert_eq!(fee.max_limiter_duration, deserialized.max_limiter_duration);
    assert_eq!(fee.max_fee_bps, deserialized.max_fee_bps);
    assert_eq!(fee.reference_amount, deserialized.reference_amount);

    // convert back to base fee params
    let reverse_base_fee_params = base_fee_info_to_base_fee_parameters(&base_fee_info_struct);
    assert!(reverse_base_fee_params.is_ok());

    let reverse_base_fee_params = reverse_base_fee_params.unwrap();
    assert_eq!(base_fee_params.data, reverse_base_fee_params.data);
}

#[test]
fn test_base_fee_serde_time_scheduler() {
    let fee = BorshFeeTimeScheduler {
        cliff_fee_numerator: 1_000_000,
        number_of_period: 20,
        period_frequency: 300,
        reduction_factor: 271,
        base_fee_mode: BaseFeeMode::FeeTimeSchedulerExponential.into(),
        ..Default::default()
    };

    // convert to base fee params
    let mut base_fee_params = BaseFeeParameters::default();
    let bytes = fee.try_to_vec().unwrap();
    base_fee_params.data.copy_from_slice(&bytes);

    assert!(BorshFeeRateLimiter::try_from_slice(&base_fee_params.data).is_ok());
    assert!(BorshFeeMarketCapScheduler::try_from_slice(&base_fee_params.data).is_ok());
    assert!(BorshFeeTimeScheduler::try_from_slice(&base_fee_params.data).is_ok());

    let deserialized = BorshFeeTimeScheduler::try_from_slice(&base_fee_params.data).unwrap();
    assert_eq!(fee, deserialized);

    // convert to base fee struct
    let base_fee_info_struct = base_fee_parameters_to_base_fee_info(&base_fee_params);
    assert!(base_fee_info_struct.is_ok());

    let base_fee_info_struct = base_fee_info_struct.unwrap();

    assert!(bytemuck::try_from_bytes::<PodAlignedFeeRateLimiter>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());
    assert!(bytemuck::try_from_bytes::<PodAlignedFeeMarketCapScheduler>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());
    assert!(bytemuck::try_from_bytes::<PodAlignedFeeTimeScheduler>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());

    let deserialized =
        *bytemuck::from_bytes::<PodAlignedFeeTimeScheduler>(base_fee_info_struct.data.as_slice());
    assert_eq!(fee.base_fee_mode, deserialized.base_fee_mode);
    assert_eq!(fee.cliff_fee_numerator, deserialized.cliff_fee_numerator);
    assert_eq!(fee.number_of_period, deserialized.number_of_period);
    assert_eq!(fee.period_frequency, deserialized.period_frequency);
    assert_eq!(fee.reduction_factor, deserialized.reduction_factor);

    // convert back to base fee params
    let reverse_base_fee_params = base_fee_info_to_base_fee_parameters(&base_fee_info_struct);
    assert!(reverse_base_fee_params.is_ok());

    let reverse_base_fee_params = reverse_base_fee_params.unwrap();
    assert_eq!(base_fee_params.data, reverse_base_fee_params.data);
}

#[test]
fn test_base_fee_serde_market_cap_scheduler() {
    let fee = BorshFeeMarketCapScheduler {
        cliff_fee_numerator: 1_000_000,
        number_of_period: 20,
        price_step_bps: 300,
        reduction_factor: 271,
        scheduler_expiration_duration: 800,
        base_fee_mode: BaseFeeMode::FeeMarketCapSchedulerExponential.into(),
        ..Default::default()
    };

    // convert to base fee params
    let mut base_fee_params = BaseFeeParameters::default();
    let bytes = fee.try_to_vec().unwrap();
    base_fee_params.data.copy_from_slice(&bytes);

    assert!(BorshFeeRateLimiter::try_from_slice(&base_fee_params.data).is_ok());
    assert!(BorshFeeMarketCapScheduler::try_from_slice(&base_fee_params.data).is_ok());
    assert!(BorshFeeTimeScheduler::try_from_slice(&base_fee_params.data).is_ok());

    let deserialized = BorshFeeMarketCapScheduler::try_from_slice(&base_fee_params.data).unwrap();
    assert_eq!(fee, deserialized);

    // convert to base fee struct
    let base_fee_info_struct = base_fee_parameters_to_base_fee_info(&base_fee_params);
    assert!(base_fee_info_struct.is_ok());

    let base_fee_info_struct = base_fee_info_struct.unwrap();

    assert!(bytemuck::try_from_bytes::<PodAlignedFeeRateLimiter>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());
    assert!(bytemuck::try_from_bytes::<PodAlignedFeeMarketCapScheduler>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());
    assert!(bytemuck::try_from_bytes::<PodAlignedFeeTimeScheduler>(
        base_fee_info_struct.data.as_slice()
    )
    .is_ok());

    let deserialized = *bytemuck::from_bytes::<PodAlignedFeeMarketCapScheduler>(
        base_fee_info_struct.data.as_slice(),
    );
    assert_eq!(fee.base_fee_mode, deserialized.base_fee_mode);
    assert_eq!(fee.cliff_fee_numerator, deserialized.cliff_fee_numerator);
    assert_eq!(fee.number_of_period, deserialized.number_of_period);
    assert_eq!(fee.reduction_factor, deserialized.reduction_factor);
    assert_eq!(fee.price_step_bps, deserialized.price_step_bps);

    // convert back to base fee params
    let reverse_base_fee_params = base_fee_info_to_base_fee_parameters(&base_fee_info_struct);
    assert!(reverse_base_fee_params.is_ok());

    let reverse_base_fee_params = reverse_base_fee_params.unwrap();
    assert_eq!(base_fee_params.data, reverse_base_fee_params.data);
}

#[test]
fn test_base_fee_params_base_fee_mode_offset_valid() {
    let borsh_fee_params_0 = BorshFeeMarketCapScheduler {
        base_fee_mode: BaseFeeMode::FeeMarketCapSchedulerExponential.into(),
        ..Default::default()
    };

    let mut base_fee_params_0 = BaseFeeParameters::default();
    borsh::to_writer(base_fee_params_0.data.as_mut_slice(), &borsh_fee_params_0).unwrap();

    let base_fee_mode_0: u8 = base_fee_params_0.get_base_fee_mode().unwrap().into();
    assert_eq!(base_fee_mode_0, borsh_fee_params_0.base_fee_mode);

    let borsh_fee_params_1 = BorshFeeRateLimiter {
        base_fee_mode: BaseFeeMode::RateLimiter.into(),
        ..Default::default()
    };

    let mut base_fee_params_1 = BaseFeeParameters::default();
    borsh::to_writer(base_fee_params_1.data.as_mut_slice(), &borsh_fee_params_1).unwrap();

    let base_fee_mode_1: u8 = base_fee_params_1.get_base_fee_mode().unwrap().into();
    assert_eq!(base_fee_mode_1, borsh_fee_params_1.base_fee_mode);

    let borsh_fee_params_2 = BorshFeeTimeScheduler {
        base_fee_mode: BaseFeeMode::FeeTimeSchedulerLinear.into(),
        ..Default::default()
    };

    let mut base_fee_params_2 = BaseFeeParameters::default();
    borsh::to_writer(base_fee_params_2.data.as_mut_slice(), &borsh_fee_params_2).unwrap();

    let base_fee_mode_2: u8 = base_fee_params_2.get_base_fee_mode().unwrap().into();
    assert_eq!(base_fee_mode_2, borsh_fee_params_2.base_fee_mode);
}
