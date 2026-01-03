use crate::base_fee::fee_market_cap_scheduler::{
    BorshFeeMarketCapScheduler, PodAlignedFeeMarketCapScheduler,
};
use crate::base_fee::fee_rate_limiter::{BorshFeeRateLimiter, PodAlignedFeeRateLimiter};
use crate::base_fee::fee_time_scheduler::{BorshFeeTimeScheduler, PodAlignedFeeTimeScheduler};
use crate::base_fee::BaseFeeHandler;
use crate::state::fee::BaseFeeMode;
use crate::state::BaseFeeInfo;
use crate::{params::fee_parameters::BaseFeeParameters, PoolError};
use anchor_lang::prelude::*;

pub trait BorshBaseFeeSerde {
    fn to_pod_aligned_bytes(&self) -> Result<[u8; BaseFeeInfo::INIT_SPACE]>;
}

pub trait PodAlignedBaseFeeSerde {
    fn to_borsh_bytes(&self) -> Result<[u8; BaseFeeParameters::INIT_SPACE]>;
}

pub trait BaseFeeEnumReader {
    const BASE_FEE_MODE_OFFSET: usize;
    fn get_base_fee_mode(&self) -> Result<BaseFeeMode>;
}

impl BaseFeeEnumReader for BaseFeeParameters {
    const BASE_FEE_MODE_OFFSET: usize = 26;
    fn get_base_fee_mode(&self) -> Result<BaseFeeMode> {
        let mode_byte = self
            .data
            .get(Self::BASE_FEE_MODE_OFFSET)
            .ok_or(PoolError::UndeterminedError)?;
        Ok(BaseFeeMode::try_from(*mode_byte).map_err(|_| PoolError::InvalidBaseFeeMode)?)
    }
}

impl BaseFeeEnumReader for BaseFeeInfo {
    const BASE_FEE_MODE_OFFSET: usize = 8;
    fn get_base_fee_mode(&self) -> Result<BaseFeeMode> {
        let mode_byte = self
            .data
            .get(Self::BASE_FEE_MODE_OFFSET)
            .ok_or(PoolError::UndeterminedError)?;
        Ok(BaseFeeMode::try_from(*mode_byte).map_err(|_| PoolError::InvalidBaseFeeMode)?)
    }
}

pub trait BaseFeeHandlerBuilder {
    fn get_base_fee_handler(&self) -> Result<Box<dyn BaseFeeHandler>>;
}

impl BaseFeeHandlerBuilder for BaseFeeParameters {
    fn get_base_fee_handler(&self) -> Result<Box<dyn BaseFeeHandler>> {
        let base_fee_info = base_fee_parameters_to_base_fee_info(self)?;
        base_fee_info.get_base_fee_handler()
    }
}

impl BaseFeeHandlerBuilder for BaseFeeInfo {
    fn get_base_fee_handler(&self) -> Result<Box<dyn BaseFeeHandler>> {
        let base_fee_mode = self.get_base_fee_mode()?;
        match base_fee_mode {
            BaseFeeMode::FeeTimeSchedulerExponential | BaseFeeMode::FeeTimeSchedulerLinear => {
                let fee_time_scheduler =
                    *bytemuck::try_from_bytes::<PodAlignedFeeTimeScheduler>(&self.data)
                        .map_err(|_| PoolError::UndeterminedError)?;
                Ok(Box::new(fee_time_scheduler))
            }
            BaseFeeMode::RateLimiter => {
                let fee_rate_limiter =
                    *bytemuck::try_from_bytes::<PodAlignedFeeRateLimiter>(&self.data)
                        .map_err(|_| PoolError::UndeterminedError)?;
                Ok(Box::new(fee_rate_limiter))
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential
            | BaseFeeMode::FeeMarketCapSchedulerLinear => {
                let fee_market_cap_scheduler =
                    *bytemuck::try_from_bytes::<PodAlignedFeeMarketCapScheduler>(&self.data)
                        .map_err(|_| PoolError::UndeterminedError)?;
                Ok(Box::new(fee_market_cap_scheduler))
            }
        }
    }
}

pub fn base_fee_parameters_to_base_fee_info(from: &BaseFeeParameters) -> Result<BaseFeeInfo> {
    let base_fee_mode = from.get_base_fee_mode()?;
    let data = match base_fee_mode {
        BaseFeeMode::FeeTimeSchedulerExponential | BaseFeeMode::FeeTimeSchedulerLinear => {
            let borsh_serde_struct = BorshFeeTimeScheduler::try_from_slice(from.data.as_slice())?;
            borsh_serde_struct.to_pod_aligned_bytes()?
        }
        BaseFeeMode::RateLimiter => {
            let borsh_serde_struct = BorshFeeRateLimiter::try_from_slice(from.data.as_slice())?;
            borsh_serde_struct.to_pod_aligned_bytes()?
        }
        BaseFeeMode::FeeMarketCapSchedulerExponential
        | BaseFeeMode::FeeMarketCapSchedulerLinear => {
            let borsh_serde_struct =
                BorshFeeMarketCapScheduler::try_from_slice(from.data.as_slice())?;
            borsh_serde_struct.to_pod_aligned_bytes()?
        }
    };
    Ok(BaseFeeInfo { data })
}

pub fn base_fee_info_to_base_fee_parameters(from: &BaseFeeInfo) -> Result<BaseFeeParameters> {
    let base_fee_mode = from.get_base_fee_mode()?;
    let data = match base_fee_mode {
        BaseFeeMode::FeeTimeSchedulerExponential | BaseFeeMode::FeeTimeSchedulerLinear => {
            let pod_aligned_struct =
                bytemuck::try_from_bytes::<PodAlignedFeeTimeScheduler>(&from.data)
                    .map_err(|_| PoolError::UndeterminedError)?;
            pod_aligned_struct.to_borsh_bytes()?
        }
        BaseFeeMode::RateLimiter => {
            let pod_aligned_struct =
                bytemuck::try_from_bytes::<PodAlignedFeeRateLimiter>(&from.data)
                    .map_err(|_| PoolError::UndeterminedError)?;
            pod_aligned_struct.to_borsh_bytes()?
        }
        BaseFeeMode::FeeMarketCapSchedulerExponential
        | BaseFeeMode::FeeMarketCapSchedulerLinear => {
            let pod_aligned_struct =
                bytemuck::try_from_bytes::<PodAlignedFeeMarketCapScheduler>(&from.data)
                    .map_err(|_| PoolError::UndeterminedError)?;
            pod_aligned_struct.to_borsh_bytes()?
        }
    };
    Ok(BaseFeeParameters { data })
}

pub trait UpdateCliffFeeNumerator {
    fn update_cliff_fee_numerator(&mut self, new_cliff_fee_numerator: u64) -> Result<()>;
}

impl UpdateCliffFeeNumerator for BaseFeeInfo {
    fn update_cliff_fee_numerator(&mut self, new_cliff_fee_numerator: u64) -> Result<()> {
        let base_fee_mode = self.get_base_fee_mode()?;
        match base_fee_mode {
            BaseFeeMode::FeeTimeSchedulerExponential | BaseFeeMode::FeeTimeSchedulerLinear => {
                let pod_aligned_struct =
                    bytemuck::try_from_bytes_mut::<PodAlignedFeeTimeScheduler>(&mut self.data)
                        .map_err(|_| PoolError::UndeterminedError)?;
                pod_aligned_struct.cliff_fee_numerator = new_cliff_fee_numerator;
            }
            BaseFeeMode::RateLimiter => {
                let pod_aligned_struct =
                    bytemuck::try_from_bytes_mut::<PodAlignedFeeRateLimiter>(&mut self.data)
                        .map_err(|_| PoolError::UndeterminedError)?;

                pod_aligned_struct.cliff_fee_numerator = new_cliff_fee_numerator;
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential
            | BaseFeeMode::FeeMarketCapSchedulerLinear => {
                let pod_aligned_struct =
                    bytemuck::try_from_bytes_mut::<PodAlignedFeeMarketCapScheduler>(&mut self.data)
                        .map_err(|_| PoolError::UndeterminedError)?;

                pod_aligned_struct.cliff_fee_numerator = new_cliff_fee_numerator;
            }
        };
        Ok(())
    }
}
