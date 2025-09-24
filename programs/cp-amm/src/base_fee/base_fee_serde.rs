use anchor_lang::prelude::*;

use crate::base_fee::{BaseFeeHandler, FeeMarketCapScheduler, FeeTimeScheduler};
use crate::constants::MIN_SQRT_PRICE;
use crate::math::from_bytes::FromBytesExt;
use crate::safe_math::SafeMath;
use crate::state::BaseFeeConfig;
use crate::{
    base_fee::FeeRateLimiter,
    params::fee_parameters::BaseFeeParameters,
    state::fee::{BaseFeeMode, BaseFeeStruct},
    PoolError,
};
pub trait BaseFeeSerde {
    const BASE_FEE_MODE_INDEX: usize;
    fn borrow_data(&self) -> &[u8];
    fn to_base_fee_parameters_data(&self) -> [u8; 30];
    fn to_base_fee_struct_data(&self) -> [u8; 32];
    fn to_fee_time_scheduler(&self) -> Result<FeeTimeScheduler>;
    fn to_fee_rate_limiter(&self) -> Result<FeeRateLimiter>;
    fn to_fee_market_cap_scheduler(
        &self,
        min_sqrt_price_index: u64,
    ) -> Result<FeeMarketCapScheduler>;
}

impl BaseFeeSerde for BaseFeeParameters {
    const BASE_FEE_MODE_INDEX: usize = 26;

    fn borrow_data(&self) -> &[u8] {
        &self.data
    }

    fn to_base_fee_parameters_data(&self) -> [u8; 30] {
        // we never call this function
        self.data
    }
    fn to_base_fee_struct_data(&self) -> [u8; 32] {
        let mut data = [0u8; 32];
        // zero factor
        data[..8].copy_from_slice(&self.data[..8]);
        // base fee mode
        data[BaseFeeStruct::BASE_FEE_MODE_INDEX] = self.data[Self::BASE_FEE_MODE_INDEX];
        // first factor
        data[14..16].copy_from_slice(&self.data[8..10]);
        // second factor
        data[16..24].copy_from_slice(&self.data[10..18]);
        // third factor
        data[24..32].copy_from_slice(&self.data[18..26]);
        data
    }

    fn to_fee_time_scheduler(&self) -> Result<FeeTimeScheduler> {
        let base_fee_mode = BaseFeeMode::try_from(self.data[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;
        require!(
            base_fee_mode == BaseFeeMode::FeeTimeSchedulerLinear
                || base_fee_mode == BaseFeeMode::FeeTimeSchedulerExponential,
            PoolError::InvalidBaseFeeMode
        );
        Ok(FeeTimeScheduler {
            cliff_fee_numerator: u64::from_bytes(&self.data[..8]),
            number_of_period: u16::from_bytes(&self.data[8..10]),
            period_frequency: u64::from_bytes(&self.data[10..18]),
            reduction_factor: u64::from_bytes(&self.data[18..26]),
            fee_scheduler_mode: self.data[Self::BASE_FEE_MODE_INDEX],
        })
    }

    fn to_fee_rate_limiter(&self) -> Result<FeeRateLimiter> {
        let base_fee_mode = BaseFeeMode::try_from(self.data[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;
        require!(
            base_fee_mode == BaseFeeMode::RateLimiter,
            PoolError::InvalidBaseFeeMode
        );
        Ok(FeeRateLimiter {
            cliff_fee_numerator: u64::from_bytes(&self.data[..8]),
            fee_increment_bps: u16::from_bytes(&self.data[8..10]),
            max_limiter_duration: u32::from_bytes(&self.data[10..14]),
            max_fee_bps: u32::from_bytes(&self.data[14..18]),
            reference_amount: u64::from_bytes(&self.data[18..26]),
        })
    }

    fn to_fee_market_cap_scheduler(
        &self,
        min_sqrt_price_index: u64,
    ) -> Result<FeeMarketCapScheduler> {
        let base_fee_mode = BaseFeeMode::try_from(self.data[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;
        require!(
            base_fee_mode == BaseFeeMode::FeeMarketCapSchedulerLinear
                || base_fee_mode == BaseFeeMode::FeeMarketCapSchedulerExponential,
            PoolError::InvalidBaseFeeMode
        );

        let cliff_fee_numerator = u32::from_bytes(&self.data[..4]);
        let scheduler_expiration_duration = u32::from_bytes(&self.data[4..8]);
        let max_sqrt_price_delta_vbps = u16::from_bytes(&self.data[8..10]);
        let max_sqrt_price_index = u64::from_bytes(&self.data[10..18]);
        let reduction_factor = u64::from_bytes(&self.data[18..26]);
        let fee_scheduler_mode = self.data[Self::BASE_FEE_MODE_INDEX];

        let min_sqrt_price = MIN_SQRT_PRICE.safe_mul(min_sqrt_price_index.into())?;
        let max_sqrt_price = MIN_SQRT_PRICE.safe_mul(max_sqrt_price_index.into())?;

        Ok(FeeMarketCapScheduler {
            cliff_fee_numerator,
            min_sqrt_price,
            max_sqrt_price,
            max_sqrt_price_delta_vbps,
            reduction_factor,
            scheduler_expiration_duration,
            fee_scheduler_mode,
        })
    }
}

trait BorrowData {
    fn borrow_data(&self) -> &[u8];
}
impl BorrowData for BaseFeeStruct {
    fn borrow_data(&self) -> &[u8] {
        &self.data
    }
}
impl BorrowData for BaseFeeConfig {
    fn borrow_data(&self) -> &[u8] {
        &self.data
    }
}

impl<T: BorrowData> BaseFeeSerde for T {
    const BASE_FEE_MODE_INDEX: usize = 8;
    fn borrow_data(&self) -> &[u8] {
        self.borrow_data()
    }

    fn to_base_fee_parameters_data(&self) -> [u8; 30] {
        let mut data: [u8; 30] = [0u8; 30];
        // zero factor
        data[..8].copy_from_slice(&self.borrow_data()[..8]);
        // base fee mode
        data[26] = self.borrow_data()[8];
        // first factor
        data[8..10].copy_from_slice(&self.borrow_data()[14..16]);
        // second factor
        data[10..18].copy_from_slice(&self.borrow_data()[16..24]);
        // third factor
        data[18..26].copy_from_slice(&self.borrow_data()[24..32]);
        data
    }
    fn to_base_fee_struct_data(&self) -> [u8; 32] {
        // we never call this function
        self.borrow_data().try_into().unwrap()
    }

    fn to_fee_time_scheduler(&self) -> Result<FeeTimeScheduler> {
        let base_fee_mode = BaseFeeMode::try_from(self.borrow_data()[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;
        require!(
            base_fee_mode == BaseFeeMode::FeeTimeSchedulerLinear
                || base_fee_mode == BaseFeeMode::FeeTimeSchedulerExponential,
            PoolError::InvalidBaseFeeMode
        );
        Ok(FeeTimeScheduler {
            cliff_fee_numerator: u64::from_bytes(&self.borrow_data()[..8]),
            number_of_period: u16::from_bytes(&self.borrow_data()[14..16]),
            period_frequency: u64::from_bytes(&self.borrow_data()[16..24]),
            reduction_factor: u64::from_bytes(&self.borrow_data()[24..32]),
            fee_scheduler_mode: self.borrow_data()[Self::BASE_FEE_MODE_INDEX],
        })
    }

    fn to_fee_rate_limiter(&self) -> Result<FeeRateLimiter> {
        let base_fee_mode = BaseFeeMode::try_from(self.borrow_data()[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;
        require!(
            base_fee_mode == BaseFeeMode::RateLimiter,
            PoolError::InvalidBaseFeeMode
        );
        Ok(FeeRateLimiter {
            cliff_fee_numerator: u64::from_bytes(&self.borrow_data()[..8]),
            fee_increment_bps: u16::from_bytes(&self.borrow_data()[14..16]),
            max_limiter_duration: u32::from_bytes(&self.borrow_data()[16..20]),
            max_fee_bps: u32::from_bytes(&self.borrow_data()[20..24]),
            reference_amount: u64::from_bytes(&self.borrow_data()[24..32]),
        })
    }

    fn to_fee_market_cap_scheduler(
        &self,
        min_sqrt_price_index: u64,
    ) -> Result<FeeMarketCapScheduler> {
        let base_fee_mode = BaseFeeMode::try_from(self.borrow_data()[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;
        require!(
            base_fee_mode == BaseFeeMode::FeeMarketCapSchedulerLinear
                || base_fee_mode == BaseFeeMode::FeeMarketCapSchedulerExponential,
            PoolError::InvalidBaseFeeMode
        );

        let cliff_fee_numerator = u32::from_bytes(&self.borrow_data()[..4]);
        let scheduler_expiration_duration = u32::from_bytes(&self.borrow_data()[4..8]);
        let max_sqrt_price_delta_vbps = u16::from_bytes(&self.borrow_data()[14..16]);
        let max_sqrt_price_index = u64::from_bytes(&self.borrow_data()[16..24]);
        let reduction_factor = u64::from_bytes(&self.borrow_data()[24..32]);
        let fee_scheduler_mode = self.borrow_data()[Self::BASE_FEE_MODE_INDEX];
        let min_sqrt_price = MIN_SQRT_PRICE.safe_mul(min_sqrt_price_index.into())?;
        let max_sqrt_price = MIN_SQRT_PRICE.safe_mul(max_sqrt_price_index.into())?;

        Ok(FeeMarketCapScheduler {
            cliff_fee_numerator,
            min_sqrt_price,
            max_sqrt_price,
            max_sqrt_price_delta_vbps,
            reduction_factor,
            scheduler_expiration_duration,
            fee_scheduler_mode,
        })
    }
}

pub trait BaseFeeHandlerBuilder {
    fn get_base_fee_handler(&self, min_sqrt_price_index: u64) -> Result<Box<dyn BaseFeeHandler>>;
}

impl<T: BaseFeeSerde> BaseFeeHandlerBuilder for T {
    fn get_base_fee_handler(&self, min_sqrt_price_index: u64) -> Result<Box<dyn BaseFeeHandler>> {
        let base_fee_mode = BaseFeeMode::try_from(self.borrow_data()[Self::BASE_FEE_MODE_INDEX])
            .map_err(|_| PoolError::InvalidBaseFeeMode)?;

        match base_fee_mode {
            BaseFeeMode::FeeTimeSchedulerLinear | BaseFeeMode::FeeTimeSchedulerExponential => {
                Ok(Box::new(self.to_fee_time_scheduler()?))
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential
            | BaseFeeMode::FeeMarketCapSchedulerLinear => Ok(Box::new(
                self.to_fee_market_cap_scheduler(min_sqrt_price_index)?,
            )),
            BaseFeeMode::RateLimiter => Ok(Box::new(self.to_fee_rate_limiter()?)),
        }
    }
}
