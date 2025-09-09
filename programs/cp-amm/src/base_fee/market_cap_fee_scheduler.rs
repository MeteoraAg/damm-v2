use crate::{
    activation_handler::ActivationType,
    base_fee::{BaseFeeHandler, FeeSchedulerMode},
    constants::{
        fee::{
            get_max_fee_numerator, CURRENT_POOL_VERSION, FEE_DENOMINATOR, MAX_BASIS_POINT,
            MIN_FEE_NUMERATOR,
        },
        MIN_SQRT_PRICE,
    },
    fee_math::get_fee_in_period,
    params::{fee_parameters::validate_fee_fraction, swap::TradeDirection},
    safe_math::SafeMath,
    state::CollectFeeMode,
    PoolError,
};
use anchor_lang::prelude::*;

pub struct MarketCapFeeScheduler {
    pub cliff_fee_numerator: u64,
    pub min_sqrt_price: u128,
    pub max_sqrt_price: u128,
    pub max_sqrt_price_delta_vbps: u16,
    pub reduction_factor: u64,
    pub scheduler_expiration_duration: u64,
    pub fee_scheduler_mode: u8,
}

impl MarketCapFeeScheduler {
    pub fn new(
        cliff_fee_numerator: u64,
        min_sqrt_price_index: u64,
        max_sqrt_price_index: u64,
        max_sqrt_price_delta_vbps: u16,
        reduction_factor: u64,
        scheduler_expiration_duration: u64,
        fee_scheduler_mode: u8,
    ) -> Result<Self> {
        let min_sqrt_price = MIN_SQRT_PRICE.safe_mul(min_sqrt_price_index.into())?;
        let max_sqrt_price = MIN_SQRT_PRICE.safe_mul(max_sqrt_price_index.into())?;
        Ok(Self {
            cliff_fee_numerator,
            min_sqrt_price,
            max_sqrt_price,
            max_sqrt_price_delta_vbps,
            reduction_factor,
            scheduler_expiration_duration,
            fee_scheduler_mode,
        })
    }

    pub fn get_max_base_fee_numerator(&self) -> u64 {
        self.cliff_fee_numerator
    }

    pub fn get_min_base_fee_numerator(&self) -> Result<u64> {
        self.get_base_fee_numerator_by_sqrt_price(self.min_sqrt_price)
    }

    fn get_base_fee_numerator_by_sqrt_price(&self, sqrt_price: u128) -> Result<u64> {
        let sqrt_price = sqrt_price.min(self.max_sqrt_price).max(self.min_sqrt_price);

        let total_sqrt_price_delta = self.max_sqrt_price.safe_sub(self.min_sqrt_price)?;
        let sqrt_price_delta = sqrt_price.safe_sub(self.min_sqrt_price)?;

        let sqrt_price_delta_vbps: u16 = sqrt_price_delta
            .safe_mul(u128::from(self.max_sqrt_price_delta_vbps))?
            .safe_div(total_sqrt_price_delta)?
            .try_into()?;

        let base_fee_mode = FeeSchedulerMode::try_from(self.fee_scheduler_mode)
            .map_err(|_| PoolError::TypeCastFailed)?;

        match base_fee_mode {
            FeeSchedulerMode::Linear => {
                let fee_numerator = self.cliff_fee_numerator.safe_sub(
                    self.reduction_factor
                        .safe_mul(sqrt_price_delta_vbps.into())?,
                )?;
                Ok(fee_numerator)
            }
            FeeSchedulerMode::Exponential => {
                let fee_numerator = get_fee_in_period(
                    self.cliff_fee_numerator,
                    self.reduction_factor,
                    sqrt_price_delta_vbps,
                )?;
                Ok(fee_numerator)
            }
        }
    }

    pub fn get_base_fee_numerator(
        &self,
        current_point: u64,
        activation_point: u64,
        sqrt_price: u128,
    ) -> Result<u64> {
        let scheduler_expiration_point =
            activation_point.safe_add(self.scheduler_expiration_duration)?;
        // Expired or alpha vault is buying
        if current_point > scheduler_expiration_point || current_point < activation_point {
            return self.get_min_base_fee_numerator();
        }

        self.get_base_fee_numerator_by_sqrt_price(sqrt_price)
    }
}

impl BaseFeeHandler for MarketCapFeeScheduler {
    fn validate(
        &self,
        _collect_fee_mode: CollectFeeMode,
        _activation_type: ActivationType,
    ) -> Result<()> {
        require!(
            self.min_sqrt_price < self.max_sqrt_price,
            PoolError::InvalidFeeScheduler
        );

        require!(
            u64::from(self.max_sqrt_price_delta_vbps) >= MAX_BASIS_POINT,
            PoolError::InvalidFeeScheduler
        );
        require!(self.reduction_factor > 0, PoolError::InvalidFeeScheduler);

        let fee_scheduler_mode = FeeSchedulerMode::try_from(self.fee_scheduler_mode);
        require!(fee_scheduler_mode.is_ok(), PoolError::InvalidBaseFeeMode);

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

    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        _trade_direction: TradeDirection,
        _excluded_fee_amount: u64,
        sqrt_price: u128,
    ) -> Result<u64> {
        self.get_base_fee_numerator(current_point, activation_point, sqrt_price)
    }

    fn get_base_fee_numerator_from_included_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        _trade_direction: TradeDirection,
        _included_fee_amount: u64,
        sqrt_price: u128,
    ) -> Result<u64> {
        self.get_base_fee_numerator(current_point, activation_point, sqrt_price)
    }
}
