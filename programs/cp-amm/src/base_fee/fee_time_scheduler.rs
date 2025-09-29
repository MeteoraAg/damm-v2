use super::BaseFeeHandler;
use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeEnumReader, BorshBaseFeeSerde, PodAlignedBaseFeeSerde},
    constants::fee::{
        get_max_fee_numerator, CURRENT_POOL_VERSION, FEE_DENOMINATOR, MIN_FEE_NUMERATOR,
    },
    fee_math::get_fee_in_period,
    math::safe_math::SafeMath,
    params::{
        fee_parameters::{validate_fee_fraction, BaseFeeParameters},
        swap::TradeDirection,
    },
    state::{fee::BaseFeeMode, BaseFeeInfo, CollectFeeMode},
    PoolError,
};
use anchor_lang::prelude::*;

#[derive(
    Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default, PartialEq, Eq,
)]
pub struct BorshFeeTimeScheduler {
    pub cliff_fee_numerator: u64,
    pub number_of_period: u16,
    pub period_frequency: u64,
    pub reduction_factor: u64,
    // Must at offset 26 (without memory alignment padding)
    pub base_fee_mode: u8,
    pub padding: [u8; 3],
}

static_assertions::const_assert_eq!(
    BorshFeeTimeScheduler::INIT_SPACE,
    BaseFeeParameters::INIT_SPACE
);

static_assertions::const_assert_eq!(
    BaseFeeParameters::BASE_FEE_MODE_OFFSET,
    std::mem::offset_of!(BorshFeeTimeScheduler, base_fee_mode)
);

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

#[account(zero_copy)]
#[derive(Default, Debug, InitSpace)]
pub struct PodAlignedFeeTimeScheduler {
    pub cliff_fee_numerator: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 5],
    pub number_of_period: u16,
    pub period_frequency: u64,
    pub reduction_factor: u64,
}

static_assertions::const_assert_eq!(
    BaseFeeInfo::INIT_SPACE,
    PodAlignedFeeTimeScheduler::INIT_SPACE
);

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

impl PodAlignedFeeTimeScheduler {
    pub fn get_max_base_fee_numerator(&self) -> u64 {
        self.cliff_fee_numerator
    }

    pub fn get_min_base_fee_numerator(&self) -> Result<u64> {
        self.get_base_fee_numerator_by_period(self.number_of_period.into())
    }

    fn get_base_fee_numerator_by_period(&self, period: u64) -> Result<u64> {
        let period = period.min(self.number_of_period.into());

        let base_fee_mode =
            BaseFeeMode::try_from(self.base_fee_mode).map_err(|_| PoolError::TypeCastFailed)?;

        match base_fee_mode {
            BaseFeeMode::FeeTimeSchedulerLinear => {
                let fee_numerator = self
                    .cliff_fee_numerator
                    .safe_sub(self.reduction_factor.safe_mul(period)?)?;
                Ok(fee_numerator)
            }
            BaseFeeMode::FeeTimeSchedulerExponential => {
                let period = u16::try_from(period).map_err(|_| PoolError::MathOverflow)?;
                let fee_numerator =
                    get_fee_in_period(self.cliff_fee_numerator, self.reduction_factor, period)?;
                Ok(fee_numerator)
            }
            _ => Err(PoolError::UndeterminedError.into()),
        }
    }

    pub fn get_base_fee_numerator(&self, current_point: u64, activation_point: u64) -> Result<u64> {
        if self.period_frequency == 0 {
            return Ok(self.cliff_fee_numerator);
        }
        // it means alpha-vault is buying
        let period = if current_point < activation_point {
            self.number_of_period.into()
        } else {
            let period = current_point
                .safe_sub(activation_point)?
                .safe_div(self.period_frequency)?;
            period.min(self.number_of_period.into())
        };
        self.get_base_fee_numerator_by_period(period)
    }
}

impl BaseFeeHandler for PodAlignedFeeTimeScheduler {
    fn validate(
        &self,
        _collect_fee_mode: CollectFeeMode,
        _activation_type: ActivationType,
    ) -> Result<()> {
        if self.period_frequency != 0 || self.number_of_period != 0 || self.reduction_factor != 0 {
            require!(
                self.number_of_period != 0
                    && self.period_frequency != 0
                    && self.reduction_factor != 0,
                PoolError::InvalidFeeTimeScheduler
            );
        }
        let min_fee_numerator = self.get_min_base_fee_numerator()?;
        let max_fee_numerator = self.get_max_base_fee_numerator();
        validate_fee_fraction(min_fee_numerator, FEE_DENOMINATOR)?;
        validate_fee_fraction(max_fee_numerator, FEE_DENOMINATOR)?;
        require!(
            min_fee_numerator >= MIN_FEE_NUMERATOR
                && max_fee_numerator <= get_max_fee_numerator(CURRENT_POOL_VERSION)?,
            PoolError::ExceedMaxFeeBps
        );
        Ok(())
    }

    fn get_base_fee_numerator_from_included_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        _trade_direction: TradeDirection,
        _included_fee_amount: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        self.get_base_fee_numerator(current_point, activation_point)
    }

    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        _trade_direction: TradeDirection,
        _excluded_fee_amount: u64,
        _init_sqrt_price: u128,
        _current_sqrt_price: u128,
    ) -> Result<u64> {
        self.get_base_fee_numerator(current_point, activation_point)
    }
}
