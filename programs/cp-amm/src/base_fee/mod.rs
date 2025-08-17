pub mod fee_scheduler;
pub use fee_scheduler::*;
pub mod fee_rate_limiter;
pub use fee_rate_limiter::*;

use anchor_lang::prelude::*;

use crate::{
    activation_handler::ActivationType,
    params::swap::TradeDirection,
    state::{fee::BaseFeeMode, CollectFeeMode},
    PoolError,
};

pub trait BaseFeeHandler {
    fn validate(
        &self,
        collect_fee_mode: CollectFeeMode,
        activation_type: ActivationType,
    ) -> Result<()>;
    fn get_base_fee_numerator_from_included_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
        included_fee_amount: u64,
    ) -> Result<u64>;
    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
        excluded_fee_amount: u64,
    ) -> Result<u64>;
}

pub fn get_base_fee_handler(
    cliff_fee_numerator: u64,
    first_factor: u16,
    second_factor: [u8; 8],
    third_factor: u64,
    base_fee_mode: u8,
) -> Result<Box<dyn BaseFeeHandler>> {
    let base_fee_mode =
        BaseFeeMode::try_from(base_fee_mode).map_err(|_| PoolError::InvalidBaseFeeMode)?;
    match base_fee_mode {
        BaseFeeMode::FeeSchedulerLinear | BaseFeeMode::FeeSchedulerExponential => {
            let fee_scheduler = FeeScheduler {
                cliff_fee_numerator,
                number_of_period: first_factor,
                period_frequency: u64::from_le_bytes(second_factor),
                reduction_factor: third_factor,
                fee_scheduler_mode: base_fee_mode.into(),
            };
            Ok(Box::new(fee_scheduler))
        }
        BaseFeeMode::RateLimiter => {
            let fee_rate_limiter = FeeRateLimiter {
                cliff_fee_numerator,
                fee_increment_bps: first_factor,
                max_limiter_duration: u32::from_le_bytes(
                    second_factor[0..4]
                        .try_into()
                        .map_err(|_| PoolError::TypeCastFailed)?,
                ),
                max_fee_bps: u32::from_le_bytes(
                    second_factor[4..8]
                        .try_into()
                        .map_err(|_| PoolError::TypeCastFailed)?,
                ),
                reference_amount: third_factor,
            };
            Ok(Box::new(fee_rate_limiter))
        }
    }
}
