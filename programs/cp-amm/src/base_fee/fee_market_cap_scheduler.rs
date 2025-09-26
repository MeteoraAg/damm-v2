use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeHandler, PodAlignedFeeMarketCapScheduler},
    constants::fee::{
        get_max_fee_numerator, CURRENT_POOL_VERSION, FEE_DENOMINATOR, MAX_BASIS_POINT,
        MIN_FEE_NUMERATOR,
    },
    fee_math::get_fee_in_period,
    params::{fee_parameters::validate_fee_fraction, swap::TradeDirection},
    safe_math::SafeMath,
    state::{fee::BaseFeeMode, CollectFeeMode},
    PoolError,
};
use anchor_lang::prelude::*;
use ruint::aliases::U256;

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
        require!(
            self.reduction_factor > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

        let min_fee_numerator = self.get_min_base_fee_numerator()?;
        let max_fee_numerator = self.cliff_fee_numerator;
        validate_fee_fraction(min_fee_numerator, FEE_DENOMINATOR)?;
        validate_fee_fraction(max_fee_numerator, FEE_DENOMINATOR)?;

        require!(
            self.price_step_bps > 0,
            PoolError::InvalidFeeMarketCapScheduler
        );

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
