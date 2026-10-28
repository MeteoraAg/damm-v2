use super::BaseFeeHandler;
use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeEnumReader, BorshBaseFeeSerde, PodAlignedBaseFeeSerde},
    constants::fee::{FEE_DENOMINATOR, MIN_FEE_NUMERATOR},
    params::{
        fee_parameters::{to_numerator, BaseFeeParameters},
        swap::TradeDirection,
    },
    state::{BaseFeeInfo, CollectFeeMode},
    PoolError,
};
use anchor_lang::prelude::*;

/// Deprecated. New configs and pools can no longer use BaseFeeMode::RateLimiter.
/// Existing pools always charge cliff_fee_numerator as a flat base fee.
/// The struct is kept so that existing pool and config accounts still deserialize.
#[derive(
    Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default, PartialEq, Eq,
)]
pub struct BorshFeeRateLimiter {
    pub cliff_fee_numerator: u64,
    pub fee_increment_bps: u16,
    pub max_limiter_duration: u32,
    pub max_fee_bps: u32,
    pub reference_amount: u64,
    // Must at offset 26 (without memory alignment padding)
    pub base_fee_mode: u8,
}
static_assertions::const_assert_eq!(
    BaseFeeParameters::INIT_SPACE,
    BorshFeeRateLimiter::INIT_SPACE
);

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

#[account(zero_copy)]
#[derive(Default, Debug, InitSpace)]
pub struct PodAlignedFeeRateLimiter {
    pub cliff_fee_numerator: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 5],
    pub fee_increment_bps: u16,
    pub max_limiter_duration: u32,
    pub max_fee_bps: u32,
    pub reference_amount: u64,
}

static_assertions::const_assert_eq!(
    BaseFeeInfo::INIT_SPACE,
    PodAlignedFeeRateLimiter::INIT_SPACE
);

static_assertions::const_assert_eq!(
    BaseFeeInfo::BASE_FEE_MODE_OFFSET,
    std::mem::offset_of!(PodAlignedFeeRateLimiter, base_fee_mode)
);

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

impl BaseFeeHandler for PodAlignedFeeRateLimiter {
    fn validate(
        &self,
        _collect_fee_mode: CollectFeeMode,
        _activation_type: ActivationType,
    ) -> Result<()> {
        let max_fee_numerator_from_bps =
            to_numerator(self.max_fee_bps.into(), FEE_DENOMINATOR.into())?;

        require!(
            self.cliff_fee_numerator >= MIN_FEE_NUMERATOR
                && self.cliff_fee_numerator <= max_fee_numerator_from_bps,
            PoolError::InvalidFeeRateLimiter
        );
        Ok(())
    }

    fn get_base_fee_numerator_from_included_fee_amount(
        &self,
        _current_point: u64,
        _activation_point: u64,
        _trade_direction: TradeDirection,
        _included_fee_amount: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        Ok(self.cliff_fee_numerator)
    }

    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        _current_point: u64,
        _activation_point: u64,
        _trade_direction: TradeDirection,
        _excluded_fee_amount: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        Ok(self.cliff_fee_numerator)
    }

    fn validate_base_fee_is_static(
        &self,
        _current_point: u64,
        _activation_point: u64,
    ) -> Result<bool> {
        Ok(true)
    }

    fn get_min_fee_numerator(&self) -> Result<u64> {
        Ok(self.cliff_fee_numerator)
    }

    fn get_max_fee_numerator(&self) -> Result<u64> {
        Ok(self.cliff_fee_numerator)
    }
}
