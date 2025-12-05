pub mod base_fee_serde;
pub mod fee_market_cap_scheduler;
pub mod fee_rate_limiter;
pub mod fee_time_scheduler;
pub use base_fee_serde::*;

use anchor_lang::prelude::*;

use crate::{
    activation_handler::ActivationType, params::swap::TradeDirection, state::CollectFeeMode,
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
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64>;
    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
        excluded_fee_amount: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64>;

    fn validate_base_fee_is_static(
        &self,
        current_point: u64,
        activation_point: u64,
    ) -> Result<bool>;

    fn validate_post_update_pool_fees(
        &self,
        collect_fee_mode: CollectFeeMode,
        activation_type: ActivationType,
    ) -> Result<()>;
}
