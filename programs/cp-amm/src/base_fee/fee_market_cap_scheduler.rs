use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeEnumReader, BaseFeeHandler, BorshBaseFeeSerde, PodAlignedBaseFeeSerde},
    constants::fee::{
        get_max_fee_numerator, CURRENT_POOL_VERSION, FEE_DENOMINATOR, MAX_BASIS_POINT,
        MIN_FEE_NUMERATOR,
    },
    fee_math::get_fee_in_period,
    params::{
        fee_parameters::{validate_fee_fraction, BaseFeeParameters},
        swap::TradeDirection,
    },
    safe_math::SafeMath,
    state::{fee::BaseFeeMode, BaseFeeInfo, CollectFeeMode},
    PoolError,
};
use anchor_lang::prelude::*;
use ruint::aliases::U256;

#[derive(
    Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default, PartialEq, Eq,
)]
pub struct BorshFeeMarketCapScheduler {
    pub cliff_fee_numerator: u64,
    pub number_of_period: u16,
    pub price_step_bps: u32, // similar to period_frequency in fee time scheduler
    pub scheduler_expiration_duration: u32,
    pub reduction_factor: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 3],
}

static_assertions::const_assert_eq!(
    BaseFeeParameters::INIT_SPACE,
    BorshFeeMarketCapScheduler::INIT_SPACE
);

static_assertions::const_assert_eq!(
    BaseFeeParameters::BASE_FEE_MODE_OFFSET,
    std::mem::offset_of!(BorshFeeMarketCapScheduler, base_fee_mode)
);

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

#[account(zero_copy)]
#[derive(Default, Debug, InitSpace)]
pub struct PodAlignedFeeMarketCapScheduler {
    pub cliff_fee_numerator: u64,
    pub base_fee_mode: u8,
    pub padding: [u8; 5],
    pub number_of_period: u16,
    pub price_step_bps: u32,
    pub scheduler_expiration_duration: u32,
    pub reduction_factor: u64,
}

static_assertions::const_assert_eq!(
    BaseFeeInfo::INIT_SPACE,
    PodAlignedFeeMarketCapScheduler::INIT_SPACE
);

static_assertions::const_assert_eq!(
    BaseFeeInfo::BASE_FEE_MODE_OFFSET,
    std::mem::offset_of!(PodAlignedFeeMarketCapScheduler, base_fee_mode)
);

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

impl PodAlignedFeeMarketCapScheduler {
    pub fn get_min_base_fee_numerator(&self) -> Result<u64> {
        self.get_base_fee_numerator_by_period(self.number_of_period.into())
    }

    fn get_base_fee_numerator_by_period(&self, period: u64) -> Result<u64> {
        let period = period.min(self.number_of_period.into());

        let base_fee_mode =
            BaseFeeMode::try_from(self.base_fee_mode).map_err(|_| PoolError::TypeCastFailed)?;

        match base_fee_mode {
            BaseFeeMode::FeeMarketCapSchedulerLinear => {
                let fee_numerator = self
                    .cliff_fee_numerator
                    .safe_sub(self.reduction_factor.safe_mul(period)?)?;
                Ok(fee_numerator)
            }
            BaseFeeMode::FeeMarketCapSchedulerExponential => {
                let period = u16::try_from(period).map_err(|_| PoolError::MathOverflow)?;
                let fee_numerator =
                    get_fee_in_period(self.cliff_fee_numerator, self.reduction_factor, period)?;
                Ok(fee_numerator)
            }
            _ => Err(PoolError::UndeterminedError.into()),
        }
    }

    pub fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64> {
        let scheduler_expiration_point =
            activation_point.safe_add(self.scheduler_expiration_duration.into())?;

        let period =
            if current_point > scheduler_expiration_point || current_point < activation_point {
                // Expired or alpha vault is buying
                self.number_of_period.into()
            } else {
                let period = if current_sqrt_price <= init_sqrt_price {
                    0u64
                } else {
                    let current_sqrt_price = U256::from(current_sqrt_price);
                    let init_sqrt_price = U256::from(init_sqrt_price);
                    let max_bps = U256::from(MAX_BASIS_POINT);
                    let price_step_bps = U256::from(self.price_step_bps);
                    let passed_period = current_sqrt_price
                        .safe_sub(init_sqrt_price)?
                        .safe_mul(max_bps)?
                        .safe_div(init_sqrt_price)?
                        .safe_div(price_step_bps)?;

                    if passed_period > U256::from(self.number_of_period) {
                        self.number_of_period.into()
                    } else {
                        // that should never return error
                        passed_period
                            .try_into()
                            .map_err(|_| PoolError::UndeterminedError)?
                    }
                };
                period.min(self.number_of_period.into())
            };
        self.get_base_fee_numerator_by_period(period)
    }
}

impl BaseFeeHandler for PodAlignedFeeMarketCapScheduler {
    fn validate(
        &self,
        _collect_fee_mode: CollectFeeMode,
        _activation_type: ActivationType,
    ) -> Result<()> {
        // doesn't allow zero fee marketcap scheduler
        require!(
            self.reduction_factor > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        require!(
            self.price_step_bps > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        require!(
            self.scheduler_expiration_duration > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        let min_fee_numerator = self.get_min_base_fee_numerator()?;
        let max_fee_numerator = self.cliff_fee_numerator;
        validate_fee_fraction(min_fee_numerator, FEE_DENOMINATOR)?;
        validate_fee_fraction(max_fee_numerator, FEE_DENOMINATOR)?;

        require!(
            min_fee_numerator >= MIN_FEE_NUMERATOR
                && max_fee_numerator <= get_max_fee_numerator(CURRENT_POOL_VERSION)?,
            PoolError::ExceedMaxFeeBps
        );

        Ok(())
    }

    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        _trade_direction: TradeDirection,
        _excluded_fee_amount: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64> {
        self.get_base_fee_numerator(
            current_point,
            activation_point,
            init_sqrt_price,
            current_sqrt_price,
        )
    }

    fn get_base_fee_numerator_from_included_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        _trade_direction: TradeDirection,
        _included_fee_amount: u64,
        init_sqrt_price: u128,
        current_sqrt_price: u128,
    ) -> Result<u64> {
        self.get_base_fee_numerator(
            current_point,
            activation_point,
            init_sqrt_price,
            current_sqrt_price,
        )
    }
}
