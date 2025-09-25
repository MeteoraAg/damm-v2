use crate::base_fee::{BaseFeeHandler, FeeTimeScheduler};
use crate::state::fee::{BaseFeeMode, BaseFeeStruct};
use crate::state::BaseFeeInfo;
use crate::{params::fee_parameters::BaseFeeParameters, PoolError};
use anchor_lang::prelude::*;

#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct BorshFeeTimeScheduler {
    pub cliff_fee_numerator: u64,
    pub number_of_period: u16,
    pub period_frequency: u64,
    pub reduction_factor: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 3],
}

static_assertions::const_assert_eq!(
    BorshFeeTimeScheduler::INIT_SPACE,
    BaseFeeParameters::INIT_SPACE
);

#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct BorshFeeRateLimiter {
    pub cliff_fee_numerator: u64,
    pub fee_increment_bps: u16,
    pub max_limiter_duration: u32,
    pub max_fee_bps: u32,
    pub reference_amount: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 3],
}

static_assertions::const_assert_eq!(
    BorshFeeRateLimiter::INIT_SPACE,
    BaseFeeParameters::INIT_SPACE
);

#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct BorshFeeMarketCapScheduler {
    pub cliff_fee_numerator: u64,
    pub number_of_period: u16,
    pub price_step_bps: u32,
    pub scheduler_expiration_duration: u32,
    pub reduction_factor: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 3],
}

static_assertions::const_assert_eq!(
    BorshFeeMarketCapScheduler::INIT_SPACE,
    BaseFeeParameters::INIT_SPACE
);

#[zero_copy]
#[derive(Default, Debug)]
pub struct PodAlignedFeeTimeScheduler {
    pub cliff_fee_numerator: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 5],
    pub number_of_period: u16,
    pub period_frequency: u64,
    pub reduction_factor: u64,
}

#[zero_copy]
#[derive(Default, Debug)]
pub struct PodAlignedFeeRateLimiter {
    pub cliff_fee_numerator: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 5],
    pub fee_increment_bps: u16,
    pub max_limiter_duration: u32,
    pub max_fee_bps: u32,
    pub reference_amount: u64,
}

#[zero_copy]
#[derive(Default, Debug)]
pub struct PodAlignedFeeMarketCapScheduler {
    pub cliff_fee_numerator: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 5],
    pub number_of_period: u16,
    pub price_step_bps: u32,
    pub scheduler_expiration_duration: u32,
    pub reduction_factor: u64,
}

pub trait BorshBaseFeeSerde {
    fn to_pod_aligned_bytes(&self) -> Result<[u8; BaseFeeInfo::INIT_SPACE]>;
}

impl BorshBaseFeeSerde for BorshFeeMarketCapScheduler {
    fn to_pod_aligned_bytes(&self) -> Result<[u8; BaseFeeInfo::INIT_SPACE]> {
        let pod_aligned_struct = PodAlignedFeeMarketCapScheduler {
            cliff_fee_numerator: self.cliff_fee_numerator,
            base_fee_mode: self.base_fee_mode,
            number_of_period: self.number_of_period,
            price_step_bps: self.price_step_bps,
            scheduler_expiration_duration: self.scheduler_expiration_duration,
            reduction_factor: self.reduction_factor,
            ..Default::default()
        };
        let aligned_bytes = bytemuck::bytes_of(&pod_aligned_struct);
        // Shall not happen
        Ok(aligned_bytes
            .try_into()
            .map_err(|_| PoolError::UndeterminedError)?)
    }
}

impl BorshBaseFeeSerde for BorshFeeTimeScheduler {
    fn to_pod_aligned_bytes(&self) -> Result<[u8; BaseFeeInfo::INIT_SPACE]> {
        let pod_aligned_struct = PodAlignedFeeTimeScheduler {
            cliff_fee_numerator: self.cliff_fee_numerator,
            base_fee_mode: self.base_fee_mode,
            number_of_period: self.number_of_period,
            period_frequency: self.period_frequency,
            reduction_factor: self.reduction_factor,
            ..Default::default()
        };
        let aligned_bytes = bytemuck::bytes_of(&pod_aligned_struct);
        // Shall not happen
        Ok(aligned_bytes
            .try_into()
            .map_err(|_| PoolError::UndeterminedError)?)
    }
}

impl BorshBaseFeeSerde for BorshFeeRateLimiter {
    fn to_pod_aligned_bytes(&self) -> Result<[u8; BaseFeeInfo::INIT_SPACE]> {
        let pod_aligned_struct = PodAlignedFeeRateLimiter {
            cliff_fee_numerator: self.cliff_fee_numerator,
            base_fee_mode: self.base_fee_mode,
            fee_increment_bps: self.fee_increment_bps,
            max_limiter_duration: self.max_limiter_duration,
            max_fee_bps: self.max_fee_bps,
            reference_amount: self.reference_amount,
            ..Default::default()
        };
        let aligned_bytes = bytemuck::bytes_of(&pod_aligned_struct);
        // Shall not happen
        Ok(aligned_bytes
            .try_into()
            .map_err(|_| PoolError::UndeterminedError)?)
    }
}

pub trait PodAlignedBaseFeeSerde {
    fn to_borsh_bytes(&self) -> Result<[u8; BaseFeeParameters::INIT_SPACE]>;
}

impl PodAlignedBaseFeeSerde for PodAlignedFeeMarketCapScheduler {
    fn to_borsh_bytes(&self) -> Result<[u8; BaseFeeParameters::INIT_SPACE]> {
        let borsh_struct = BorshFeeMarketCapScheduler {
            cliff_fee_numerator: self.cliff_fee_numerator,
            number_of_period: self.number_of_period,
            price_step_bps: self.price_step_bps,
            scheduler_expiration_duration: self.scheduler_expiration_duration,
            reduction_factor: self.reduction_factor,
            base_fee_mode: self.base_fee_mode,
            ..Default::default()
        };
        let mut bytes = [0u8; BaseFeeParameters::INIT_SPACE];
        // Shall not happen
        borsh::to_writer(&mut bytes[..], &borsh_struct)
            .map_err(|_| PoolError::UndeterminedError)?;
        Ok(bytes)
    }
}

impl PodAlignedBaseFeeSerde for PodAlignedFeeTimeScheduler {
    fn to_borsh_bytes(&self) -> Result<[u8; BaseFeeParameters::INIT_SPACE]> {
        let borsh_struct = BorshFeeTimeScheduler {
            cliff_fee_numerator: self.cliff_fee_numerator,
            number_of_period: self.number_of_period,
            period_frequency: self.period_frequency,
            reduction_factor: self.reduction_factor,
            base_fee_mode: self.base_fee_mode,
            ..Default::default()
        };
        let mut bytes = [0u8; BaseFeeParameters::INIT_SPACE];
        // Shall not happen
        borsh::to_writer(&mut bytes[..], &borsh_struct)
            .map_err(|_| PoolError::UndeterminedError)?;
        Ok(bytes)
    }
}

impl PodAlignedBaseFeeSerde for PodAlignedFeeRateLimiter {
    fn to_borsh_bytes(&self) -> Result<[u8; BaseFeeParameters::INIT_SPACE]> {
        let borsh_struct = BorshFeeRateLimiter {
            cliff_fee_numerator: self.cliff_fee_numerator,
            fee_increment_bps: self.fee_increment_bps,
            max_limiter_duration: self.max_limiter_duration,
            max_fee_bps: self.max_fee_bps,
            reference_amount: self.reference_amount,
            base_fee_mode: self.base_fee_mode,
            ..Default::default()
        };
        let mut bytes = [0u8; BaseFeeParameters::INIT_SPACE];
        // Shall not happen
        borsh::to_writer(&mut bytes[..], &borsh_struct)
            .map_err(|_| PoolError::UndeterminedError)?;
        Ok(bytes)
    }
}

pub trait BaseFeeEnumReader {
    const BASE_FEE_MODE_OFFSET: usize;
    fn get_base_fee_mode(&self) -> Result<BaseFeeMode>;
}

impl BaseFeeEnumReader for BaseFeeParameters {
    // TODO: Is there a way to make this compile-safe?
    const BASE_FEE_MODE_OFFSET: usize = 26;
    fn get_base_fee_mode(&self) -> Result<BaseFeeMode> {
        let mode_byte = self
            .data
            .get(Self::BASE_FEE_MODE_OFFSET)
            .ok_or(PoolError::UndeterminedError)?;
        Ok(BaseFeeMode::try_from(*mode_byte).map_err(|_| PoolError::InvalidBaseFeeMode)?)
    }
}

impl BaseFeeEnumReader for BaseFeeStruct {
    const BASE_FEE_MODE_OFFSET: usize = 8;
    fn get_base_fee_mode(&self) -> Result<BaseFeeMode> {
        let mode_byte = self
            .base_fee_info
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
        let base_fee_mode = self.get_base_fee_mode()?;
        match base_fee_mode {
            BaseFeeMode::FeeTimeSchedulerExponential | BaseFeeMode::FeeTimeSchedulerLinear => {
                let BorshFeeTimeScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    period_frequency,
                    reduction_factor,
                    base_fee_mode,
                    ..
                } = BorshFeeTimeScheduler::try_from_slice(&self.data)
                    .map_err(|_| PoolError::UndeterminedError)?;

                let fee_time_scheduler = FeeTimeScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    period_frequency,
                    reduction_factor,
                    fee_scheduler_mode: base_fee_mode,
                };

                Ok(Box::new(fee_time_scheduler))
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential
            | BaseFeeMode::FeeMarketCapSchedulerLinear => {
                let BorshFeeMarketCapScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    price_step_bps,
                    scheduler_expiration_duration,
                    reduction_factor,
                    base_fee_mode,
                    ..
                } = BorshFeeMarketCapScheduler::try_from_slice(&self.data)
                    .map_err(|_| PoolError::UndeterminedError)?;

                let fee_market_cap_scheduler = crate::base_fee::FeeMarketCapScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    price_step_bps,
                    scheduler_expiration_duration,
                    reduction_factor,
                    fee_scheduler_mode: base_fee_mode,
                };

                Ok(Box::new(fee_market_cap_scheduler))
            }
            BaseFeeMode::RateLimiter => {
                let BorshFeeRateLimiter {
                    cliff_fee_numerator,
                    fee_increment_bps,
                    max_limiter_duration,
                    max_fee_bps,
                    reference_amount,
                    ..
                } = BorshFeeRateLimiter::try_from_slice(&self.data)
                    .map_err(|_| PoolError::UndeterminedError)?;

                let fee_rate_limiter = crate::base_fee::FeeRateLimiter {
                    cliff_fee_numerator,
                    fee_increment_bps,
                    max_limiter_duration,
                    max_fee_bps,
                    reference_amount,
                };

                Ok(Box::new(fee_rate_limiter))
            }
        }
    }
}

impl BaseFeeHandlerBuilder for BaseFeeStruct {
    fn get_base_fee_handler(&self) -> Result<Box<dyn BaseFeeHandler>> {
        let base_fee_mode = self.get_base_fee_mode()?;
        match base_fee_mode {
            BaseFeeMode::FeeTimeSchedulerExponential | BaseFeeMode::FeeTimeSchedulerLinear => {
                let &PodAlignedFeeTimeScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    period_frequency,
                    reduction_factor,
                    base_fee_mode,
                    ..
                } = bytemuck::try_from_bytes(&self.base_fee_info.data)
                    .map_err(|_| PoolError::UndeterminedError)?;

                let fee_time_scheduler = FeeTimeScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    period_frequency,
                    reduction_factor,
                    fee_scheduler_mode: base_fee_mode,
                };

                Ok(Box::new(fee_time_scheduler))
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential
            | BaseFeeMode::FeeMarketCapSchedulerLinear => {
                let &PodAlignedFeeMarketCapScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    price_step_bps,
                    scheduler_expiration_duration,
                    reduction_factor,
                    base_fee_mode,
                    ..
                } = bytemuck::try_from_bytes(&self.base_fee_info.data)
                    .map_err(|_| PoolError::UndeterminedError)?;

                let fee_market_cap_scheduler = crate::base_fee::FeeMarketCapScheduler {
                    cliff_fee_numerator,
                    number_of_period,
                    price_step_bps,
                    scheduler_expiration_duration,
                    reduction_factor,
                    fee_scheduler_mode: base_fee_mode,
                };

                Ok(Box::new(fee_market_cap_scheduler))
            }
            BaseFeeMode::RateLimiter => {
                let &PodAlignedFeeRateLimiter {
                    cliff_fee_numerator,
                    fee_increment_bps,
                    max_limiter_duration,
                    max_fee_bps,
                    reference_amount,
                    ..
                } = bytemuck::try_from_bytes(&self.base_fee_info.data)
                    .map_err(|_| PoolError::UndeterminedError)?;

                let fee_rate_limiter = crate::base_fee::FeeRateLimiter {
                    cliff_fee_numerator,
                    fee_increment_bps,
                    max_limiter_duration,
                    max_fee_bps,
                    reference_amount,
                };

                Ok(Box::new(fee_rate_limiter))
            }
        }
    }
}

pub fn base_fee_params_to_info_struct(from: &BaseFeeParameters) -> Result<BaseFeeInfo> {
    let any_borsh_serde_struct = BorshFeeMarketCapScheduler::try_from_slice(from.data.as_slice())?;
    let data = any_borsh_serde_struct.to_pod_aligned_bytes()?;
    Ok(BaseFeeInfo { data })
}

pub fn base_fee_info_struct_to_params(from: &BaseFeeInfo) -> Result<BaseFeeParameters> {
    let any_pod_aligned_struct =
        bytemuck::try_from_bytes::<PodAlignedFeeMarketCapScheduler>(&from.data)
            .map_err(|_| PoolError::UndeterminedError)?;
    let data = any_pod_aligned_struct.to_borsh_bytes()?;
    Ok(BaseFeeParameters { data })
}
