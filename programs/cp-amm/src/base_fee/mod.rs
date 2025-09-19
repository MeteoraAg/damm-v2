pub mod time_fee_scheduler;
pub use time_fee_scheduler::*;
pub mod fee_rate_limiter;
pub use fee_rate_limiter::*;
pub mod market_cap_fee_scheduler;
pub use market_cap_fee_scheduler::*;

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
        sqrt_price: u128,
    ) -> Result<u64>;
    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
        excluded_fee_amount: u64,
        sqrt_price: u128,
    ) -> Result<u64>;
}

pub fn get_base_fee_handler(
    zero_factor: [u8; 8],
    first_factor: u16,
    second_factor: [u8; 8],
    third_factor: u64,
    base_fee_mode: u8,
    min_sqrt_price_index: u64,
) -> Result<Box<dyn BaseFeeHandler>> {
    let base_fee_mode =
        BaseFeeMode::try_from(base_fee_mode).map_err(|_| PoolError::InvalidBaseFeeMode)?;

    match base_fee_mode {
        BaseFeeMode::FeeSchedulerLinear | BaseFeeMode::FeeSchedulerExponential => {
            let fee_scheduler_mode: FeeSchedulerMode = base_fee_mode.into();
            let fee_scheduler = FeeScheduler {
                cliff_fee_numerator: u64::from_le_bytes(zero_factor),
                number_of_period: first_factor,
                period_frequency: u64::from_le_bytes(second_factor),
                reduction_factor: third_factor,
                fee_scheduler_mode: fee_scheduler_mode.into(),
            };
            Ok(Box::new(fee_scheduler))
        }
        BaseFeeMode::MarketCapFeeSchedulerExponential
        | BaseFeeMode::MarketCapFeeSchedulerLinear => {
            let mut cliff_fee_numerator_bytes = [0u8; 4];
            cliff_fee_numerator_bytes.copy_from_slice(&zero_factor[0..4]);
            let cliff_fee_numerator = u32::from_le_bytes(cliff_fee_numerator_bytes);

            let mut max_sqrt_price_index_bytes = [0u8; 8];
            max_sqrt_price_index_bytes[0..4].copy_from_slice(&zero_factor[4..8]);
            max_sqrt_price_index_bytes[4..8].copy_from_slice(&second_factor[0..4]);
            let max_sqrt_price_index = u64::from_le_bytes(max_sqrt_price_index_bytes);

            let mut scheduler_expiration_duration_bytes = [0u8; 4];
            scheduler_expiration_duration_bytes.copy_from_slice(&second_factor[4..8]);
            let scheduler_expiration_duration =
                u32::from_le_bytes(scheduler_expiration_duration_bytes);

            let fee_scheduler_mode: FeeSchedulerMode = base_fee_mode.into();

            let market_cap_fee_scheduler = MarketCapFeeScheduler::new(
                cliff_fee_numerator,
                min_sqrt_price_index,
                max_sqrt_price_index,
                first_factor,
                third_factor,
                scheduler_expiration_duration,
                fee_scheduler_mode.into(),
            )?;

            Ok(Box::new(market_cap_fee_scheduler))
        }
        BaseFeeMode::RateLimiter => {
            let fee_rate_limiter = FeeRateLimiter {
                cliff_fee_numerator: u64::from_le_bytes(zero_factor),
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
