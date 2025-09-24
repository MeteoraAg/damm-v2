use crate::{
    base_fee::{BaseFeeSerde, FeeMarketCapScheduler, FeeRateLimiter, FeeTimeScheduler},
    constants::MIN_SQRT_PRICE,
    params::fee_parameters::BaseFeeParameters,
    state::fee::{BaseFeeMode, BaseFeeStruct},
};
use anchor_lang::Result;

impl BaseFeeSerde for FeeTimeScheduler {
    const BASE_FEE_MODE_INDEX: usize = 0;
    fn borrow_data(&self) -> &[u8] {
        panic!("No need to implement this")
    }
    fn to_base_fee_parameters_data(&self) -> [u8; 30] {
        let mut data: [u8; 30] = [0u8; 30];
        // zero factor
        data[..8].copy_from_slice(&self.cliff_fee_numerator.to_le_bytes());
        // base fee mode
        data[BaseFeeParameters::BASE_FEE_MODE_INDEX] = self.fee_scheduler_mode;
        // first factor
        data[8..10].copy_from_slice(&self.number_of_period.to_le_bytes());
        // second factor
        data[10..18].copy_from_slice(&self.period_frequency.to_le_bytes());
        // third factor
        data[18..26].copy_from_slice(&self.reduction_factor.to_le_bytes());
        data
    }
    fn to_base_fee_struct_data(&self) -> [u8; 32] {
        let mut data: [u8; 32] = [0u8; 32];
        // zero factor
        data[..8].copy_from_slice(&self.cliff_fee_numerator.to_le_bytes());
        // base fee mode
        data[BaseFeeStruct::BASE_FEE_MODE_INDEX] = self.fee_scheduler_mode;
        // first factor
        data[14..16].copy_from_slice(&self.number_of_period.to_le_bytes());
        // second factor
        data[16..24].copy_from_slice(&self.period_frequency.to_le_bytes());
        // third factor
        data[24..32].copy_from_slice(&self.reduction_factor.to_le_bytes());
        data
    }
    fn to_fee_rate_limiter(&self) -> Result<FeeRateLimiter> {
        panic!("No need to implement this")
    }
    fn to_fee_time_scheduler(&self) -> Result<FeeTimeScheduler> {
        panic!("No need to implement this")
    }
    fn to_fee_market_cap_scheduler(
        &self,
        _min_sqrt_price_index: u64,
    ) -> Result<FeeMarketCapScheduler> {
        panic!("No need to implement this")
    }
}

impl BaseFeeSerde for FeeRateLimiter {
    const BASE_FEE_MODE_INDEX: usize = 0;
    fn borrow_data(&self) -> &[u8] {
        panic!("No need to implement this")
    }
    fn to_base_fee_parameters_data(&self) -> [u8; 30] {
        let mut data: [u8; 30] = [0u8; 30];
        data[..8].copy_from_slice(&self.cliff_fee_numerator.to_le_bytes());
        // base fee mode
        data[BaseFeeParameters::BASE_FEE_MODE_INDEX] = BaseFeeMode::RateLimiter.into();
        data[8..10].copy_from_slice(&self.fee_increment_bps.to_le_bytes());
        data[10..14].copy_from_slice(&self.max_limiter_duration.to_le_bytes());
        data[14..18].copy_from_slice(&self.max_fee_bps.to_le_bytes());
        data[18..26].copy_from_slice(&self.reference_amount.to_le_bytes());
        data
    }
    fn to_base_fee_struct_data(&self) -> [u8; 32] {
        let mut data: [u8; 32] = [0u8; 32];
        data[..8].copy_from_slice(&self.cliff_fee_numerator.to_le_bytes());
        // base fee mode
        data[BaseFeeStruct::BASE_FEE_MODE_INDEX] = BaseFeeMode::RateLimiter.into();
        data[14..16].copy_from_slice(&self.fee_increment_bps.to_le_bytes());
        data[16..20].copy_from_slice(&self.max_limiter_duration.to_le_bytes());
        data[20..24].copy_from_slice(&self.max_fee_bps.to_le_bytes());
        data[24..32].copy_from_slice(&self.reference_amount.to_le_bytes());
        data
    }
    fn to_fee_rate_limiter(&self) -> Result<FeeRateLimiter> {
        panic!("No need to implement this")
    }
    fn to_fee_time_scheduler(&self) -> Result<FeeTimeScheduler> {
        panic!("No need to implement this")
    }
    fn to_fee_market_cap_scheduler(
        &self,
        _min_sqrt_price_index: u64,
    ) -> Result<FeeMarketCapScheduler> {
        panic!("No need to implement this")
    }
}

impl BaseFeeSerde for FeeMarketCapScheduler {
    const BASE_FEE_MODE_INDEX: usize = 0;
    fn borrow_data(&self) -> &[u8] {
        panic!("No need to implement this")
    }
    fn to_base_fee_parameters_data(&self) -> [u8; 30] {
        let mut data: [u8; 30] = [0u8; 30];
        data[..4].copy_from_slice(&self.cliff_fee_numerator.to_le_bytes());
        // base fee mode
        data[BaseFeeParameters::BASE_FEE_MODE_INDEX] = self.fee_scheduler_mode;
        data[4..8].copy_from_slice(&self.scheduler_expiration_duration.to_le_bytes());

        data[8..10].copy_from_slice(&self.max_sqrt_price_delta_vbps.to_le_bytes());
        let max_sqrt_price_index =
            u64::try_from(self.max_sqrt_price.checked_div(MIN_SQRT_PRICE).unwrap()).unwrap();
        data[10..18].copy_from_slice(&max_sqrt_price_index.to_le_bytes());
        data[18..26].copy_from_slice(&self.reduction_factor.to_le_bytes());

        data
    }
    fn to_base_fee_struct_data(&self) -> [u8; 32] {
        let mut data: [u8; 32] = [0u8; 32];
        data[..4].copy_from_slice(&self.cliff_fee_numerator.to_le_bytes());
        // base fee mode
        data[BaseFeeStruct::BASE_FEE_MODE_INDEX] = self.fee_scheduler_mode;
        data[4..8].copy_from_slice(&self.scheduler_expiration_duration.to_le_bytes());
        data[14..16].copy_from_slice(&self.max_sqrt_price_delta_vbps.to_le_bytes());
        let max_sqrt_price_index =
            u64::try_from(self.max_sqrt_price.checked_div(MIN_SQRT_PRICE).unwrap()).unwrap();
        data[16..24].copy_from_slice(&max_sqrt_price_index.to_le_bytes());
        data[24..32].copy_from_slice(&self.reduction_factor.to_le_bytes());
        data
    }
    fn to_fee_rate_limiter(&self) -> Result<FeeRateLimiter> {
        panic!("No need to implement this")
    }
    fn to_fee_time_scheduler(&self) -> Result<FeeTimeScheduler> {
        panic!("No need to implement this")
    }
    fn to_fee_market_cap_scheduler(
        &self,
        _min_sqrt_price_index: u64,
    ) -> Result<FeeMarketCapScheduler> {
        panic!("No need to implement this")
    }
}
