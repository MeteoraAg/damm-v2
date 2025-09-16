use crate::{
    activation_handler::ActivationType,
    constants::{
        fee::{
            get_max_fee_bps, get_max_fee_numerator, CURRENT_POOL_VERSION, FEE_DENOMINATOR,
            MIN_FEE_NUMERATOR,
        },
        MAX_RATE_LIMITER_DURATION_IN_SECONDS, MAX_RATE_LIMITER_DURATION_IN_SLOTS,
    },
    params::{fee_parameters::to_numerator, swap::TradeDirection},
    safe_math::SafeMath,
    state::{fee::PoolFeesStruct, CollectFeeMode},
    u128x128_math::Rounding,
    utils_math::{safe_mul_div_cast_u64, sqrt_u256},
    PoolError,
};

use super::BaseFeeHandler;
use anchor_lang::prelude::*;
use num::Integer;
use ruint::aliases::U256;

/// we denote reference_amount = x0, cliff_fee_numerator = c, fee_increment = i
/// if input_amount <= x0, then fee = input_amount * c
///
/// if input_amount > x0, then input_amount = x0 + (a * x0 + b)
/// if a < max_index
/// then fee = x0 * c + x0 * (c + i) + .... + x0 * (c + i*a) + b * (c + i * (a+1))
/// then fee = x0 * (c + c*a + i*a*(a+1)/2) + b * (c + i * (a+1))
///
/// if a >= max_index
/// if a = max_index + d, input_amount = x0 + max_index * x0 + (d * x0 + b)
/// then fee = x0 * (c + c*max_index + i*max_index*(max_index+1)/2) + (d * x0 + b) * MAX_FEE
#[derive(Debug, Default)]
pub struct FeeRateLimiter {
    pub cliff_fee_numerator: u64,
    pub fee_increment_bps: u16,
    pub max_limiter_duration: u32,
    pub max_fee_bps: u32,
    pub reference_amount: u64,
}

impl FeeRateLimiter {
    pub fn is_rate_limiter_applied(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
    ) -> Result<bool> {
        if self.is_zero_rate_limiter() {
            return Ok(false);
        }

        // only handle for the case B to A and collect fee mode in token B
        if trade_direction == TradeDirection::AtoB {
            return Ok(false);
        }

        // it means whitelisted vault is buying
        if current_point < activation_point {
            return Ok(false);
        }

        let last_effective_rate_limiter_point =
            u128::from(activation_point).safe_add(self.max_limiter_duration.into())?;
        if u128::from(current_point) > last_effective_rate_limiter_point {
            return Ok(false);
        }
        Ok(true)
    }

    fn is_zero_rate_limiter(&self) -> bool {
        self.reference_amount == 0
            && self.max_limiter_duration == 0
            && self.max_fee_bps == 0
            && self.fee_increment_bps == 0
    }

    fn is_non_zero_rate_limiter(&self) -> bool {
        self.reference_amount != 0
            && self.max_limiter_duration != 0
            && self.max_fee_bps != 0
            && self.fee_increment_bps != 0
    }

    pub fn get_max_index(&self) -> Result<u64> {
        let max_fee_numerator = to_numerator(self.max_fee_bps.into(), FEE_DENOMINATOR.into())?;
        let delta_numerator = max_fee_numerator.safe_sub(self.cliff_fee_numerator)?;
        let fee_increment_numerator =
            to_numerator(self.fee_increment_bps.into(), FEE_DENOMINATOR.into())?;
        let max_index = delta_numerator.safe_div(fee_increment_numerator)?;
        Ok(max_index)
    }

    // export function for testing
    pub fn get_fee_numerator_from_included_fee_amount(&self, input_amount: u64) -> Result<u64> {
        let fee_numerator = if input_amount <= self.reference_amount {
            self.cliff_fee_numerator
        } else {
            let max_fee_numerator = to_numerator(self.max_fee_bps.into(), FEE_DENOMINATOR.into())?;

            let c = U256::from(self.cliff_fee_numerator);
            let (a, b) = input_amount
                .safe_sub(self.reference_amount)?
                .div_rem(&self.reference_amount);
            let a = U256::from(a);
            let b = U256::from(b);
            let max_index = U256::from(self.get_max_index()?);
            let i = U256::from(to_numerator(
                self.fee_increment_bps.into(),
                FEE_DENOMINATOR.into(),
            )?);
            let x0 = U256::from(self.reference_amount);
            let one = U256::ONE;
            let two = U256::from(2);
            // because we all calculate in U256, so it is safe to avoid safe math
            let trading_fee_numerator = if a < max_index {
                let numerator_1 = c + c * a + i * a * (a + one) / two;
                let numerator_2 = c + i * (a + one);
                let first_fee = x0 * numerator_1;
                let second_fee = b * numerator_2;
                first_fee + second_fee
            } else {
                let numerator_1 = c + c * max_index + i * max_index * (max_index + one) / two;
                let numerator_2 = U256::from(max_fee_numerator);
                let first_fee = x0 * numerator_1;

                let d = a - max_index;
                let left_amount = d * x0 + b;
                let second_fee = left_amount * numerator_2;
                first_fee + second_fee
            };

            let denominator = U256::from(FEE_DENOMINATOR);
            let trading_fee = (trading_fee_numerator + denominator - one) / denominator;
            let trading_fee = trading_fee
                .try_into()
                .map_err(|_| PoolError::TypeCastFailed)?;

            // reverse to fee numerator
            // input_amount * numerator / FEE_DENOMINATOR = trading_fee
            // then numerator = trading_fee * FEE_DENOMINATOR / input_amount
            let fee_numerator =
                safe_mul_div_cast_u64(trading_fee, FEE_DENOMINATOR, input_amount, Rounding::Up)?;
            fee_numerator
        };

        Ok(fee_numerator)
    }

    pub fn get_checked_amounts(&self) -> Result<(u64, u64, bool)> {
        let max_index = self.get_max_index()?;
        let x0 = U256::from(self.reference_amount);
        let one = U256::from(1);
        let max_index_input_amount = (U256::from(max_index) + one) * x0;
        if max_index_input_amount <= U256::from(u64::MAX) {
            let checked_included_fee_amount = max_index_input_amount
                .try_into()
                .map_err(|_| PoolError::TypeCastFailed)?;
            let checked_output_amount =
                self.get_excluded_fee_amount(checked_included_fee_amount)?;
            Ok((checked_output_amount, checked_included_fee_amount, false))
        } else {
            let checked_excluded_fee_amount = self.get_excluded_fee_amount(u64::MAX)?;
            Ok((checked_excluded_fee_amount, u64::MAX, true))
        }
    }

    pub fn get_excluded_fee_amount(&self, included_fee_amount: u64) -> Result<u64> {
        let fee_numerator = self.get_fee_numerator_from_included_fee_amount(included_fee_amount)?;
        let (excluded_fee_amount, _fee) =
            PoolFeesStruct::get_excluded_fee_amount(fee_numerator, included_fee_amount)?;
        Ok(excluded_fee_amount)
    }

    // Ref: https://github.com/MeteoraAg/dynamic-bonding-curve/blob/dd40b7d4d53bf2254f395b9f52eb7f6850d24236/programs/dynamic-bonding-curve/src/base_fee/fee_rate_limiter.rs#L103
    pub fn get_fee_numerator_from_excluded_fee_amount(
        &self,
        excluded_fee_amount: u64,
    ) -> Result<u64> {
        let excluded_fee_reference_amount = self.get_excluded_fee_amount(self.reference_amount)?;
        if excluded_fee_amount <= excluded_fee_reference_amount {
            return Ok(self.cliff_fee_numerator);
        }
        let (checked_excluded_fee_amount, checked_included_fee_amount, is_overflow) =
            self.get_checked_amounts()?;
        // add the early check
        if excluded_fee_amount == checked_excluded_fee_amount {
            return self.get_fee_numerator_from_included_fee_amount(checked_included_fee_amount);
        }
        let included_fee_amount = if excluded_fee_amount < checked_excluded_fee_amount {
            let two = U256::from(2);
            let four = U256::from(4);
            // d: fee denominator
            // ex: excluded_fee_amount
            // input_amount = x0 + (a * x0)
            // fee = x0 * (c + c*a + i*a*(a+1)/2) / d
            // fee = x0 * (a+1) * (c + i*a/2) / d
            // fee = input_amount * (c + i * (input_amount/x0-1)/2) / d
            // ex = input_amount - fee
            // ex = input_amount - input_amount * (c + i * (input_amount/x0-1)/2) / d
            // ex * d * 2 = input_amount * d * 2 - input_amount * (2 * c + i * (input_amount/x0-1))
            // ex * d * 2 * x0 = input_amount * d * 2 * x0 - input_amount * (2 * c * x0 + i * (input_amount-x0))
            // ex * d * 2 * x0 = input_amount * d * 2 * x0 - input_amount * (2 * c * x0 + i * input_amount- i*x0)
            // ex * d * 2 * x0 = input_amount * d * 2 * x0 - input_amount * 2 * c * x0 - i * input_amount ^ 2 + input_amount * i*x0
            // i * input_amount ^ 2 - input_amount * (-2 * c * x0 + i*x0 + d * 2 * x0) + ex * d * 2 * x0 = 0
            // equation: x * input_amount ^ 2  - y * input_amount + z = 0
            // x = i, y =  (-2 * c * x0 + i*x0 + d * 2 * x0), z = ex * d * 2 * x0
            // input_amount = (y +(-) sqrt(y^2 - 4xz)) / 2x
            let i = U256::from(to_numerator(
                self.fee_increment_bps.into(),
                FEE_DENOMINATOR.into(),
            )?);
            let x0 = U256::from(self.reference_amount);
            let d = U256::from(FEE_DENOMINATOR);
            let c = U256::from(self.cliff_fee_numerator);
            let ex = U256::from(excluded_fee_amount);

            let x = i; // x > 0
            let y = two * d * x0 + i * x0 - two * c * x0; // y is always greater than zero
            let z = two * ex * d * x0;

            // solve quaratic equation
            let included_fee_amount = (y - sqrt_u256(y * y - four * x * z)
                .ok_or_else(|| PoolError::MathOverflow)?)
                / (two * x);
            let a_plus_one = included_fee_amount.safe_div(x0)?;

            let first_excluded_fee_amount = self.get_excluded_fee_amount(
                included_fee_amount
                    .try_into()
                    .map_err(|_| PoolError::TypeCastFailed)?,
            )?;
            let excluded_fee_remaining_amount =
                excluded_fee_amount.safe_sub(first_excluded_fee_amount)?;

            let remaining_amount_fee_numerator = c + i * a_plus_one;

            let (included_fee_remaining_amount, _) = PoolFeesStruct::get_included_fee_amount(
                remaining_amount_fee_numerator
                    .try_into()
                    .map_err(|_| PoolError::TypeCastFailed)?,
                excluded_fee_remaining_amount,
            )?;

            let total_in_amount =
                included_fee_amount.safe_add(U256::from(included_fee_remaining_amount))?;
            let total_in_amount = total_in_amount
                .try_into()
                .map_err(|_| PoolError::TypeCastFailed)?;
            total_in_amount
        } else {
            // excluded_fee_amount > checked_excluded_fee_amount
            if is_overflow {
                return Err(PoolError::MathOverflow.into());
            }
            let excluded_fee_remaining_amount =
                excluded_fee_amount.safe_sub(checked_excluded_fee_amount)?;
            // remaining_amount should take the max fee
            let (included_fee_remaining_amount, _) = PoolFeesStruct::get_included_fee_amount(
                to_numerator(self.max_fee_bps.into(), FEE_DENOMINATOR.into())?,
                excluded_fee_remaining_amount,
            )?;

            let total_amount_in =
                included_fee_remaining_amount.safe_add(checked_included_fee_amount)?;
            total_amount_in
        };

        let trading_fee = included_fee_amount.safe_sub(excluded_fee_amount)?;

        let fee_numerator = safe_mul_div_cast_u64(
            trading_fee,
            FEE_DENOMINATOR,
            included_fee_amount,
            Rounding::Up,
        )?;

        // sanity check
        require!(
            fee_numerator >= self.cliff_fee_numerator,
            PoolError::UndeterminedError
        );
        Ok(fee_numerator)
    }
}

impl BaseFeeHandler for FeeRateLimiter {
    fn validate(
        &self,
        collect_fee_mode: CollectFeeMode,
        activation_type: ActivationType,
    ) -> Result<()> {
        // can only be applied in OnlyB collect fee mode
        require!(
            collect_fee_mode == CollectFeeMode::OnlyB,
            PoolError::InvalidFeeRateLimiter
        );
        let max_fee_numerator_from_bps =
            to_numerator(self.max_fee_bps.into(), FEE_DENOMINATOR.into())?;

        require!(
            self.cliff_fee_numerator >= MIN_FEE_NUMERATOR
                && self.cliff_fee_numerator <= max_fee_numerator_from_bps,
            PoolError::InvalidFeeRateLimiter
        );

        if self.is_zero_rate_limiter() {
            return Ok(());
        }

        require!(
            self.is_non_zero_rate_limiter(),
            PoolError::InvalidFeeRateLimiter
        );

        let max_limiter_duration = match activation_type {
            ActivationType::Slot => MAX_RATE_LIMITER_DURATION_IN_SLOTS,
            ActivationType::Timestamp => MAX_RATE_LIMITER_DURATION_IN_SECONDS,
        };

        require!(
            self.max_limiter_duration <= max_limiter_duration,
            PoolError::InvalidFeeRateLimiter
        );

        let fee_increment_numerator =
            to_numerator(self.fee_increment_bps.into(), FEE_DENOMINATOR.into())?;
        require!(
            fee_increment_numerator < FEE_DENOMINATOR,
            PoolError::InvalidFeeRateLimiter
        );

        let max_fee_bps_u64 =
            u64::try_from(self.max_fee_bps).map_err(|_| PoolError::TypeCastFailed)?;
        require!(
            max_fee_bps_u64 <= get_max_fee_bps(CURRENT_POOL_VERSION)?,
            PoolError::InvalidFeeRateLimiter
        );

        // validate max fee (more amount, then more fee)
        let min_fee_numerator = self.get_fee_numerator_from_included_fee_amount(0)?;
        let max_fee_numerator = self.get_fee_numerator_from_included_fee_amount(u64::MAX)?;
        require!(
            min_fee_numerator >= MIN_FEE_NUMERATOR
                && max_fee_numerator <= get_max_fee_numerator(CURRENT_POOL_VERSION)?,
            PoolError::InvalidFeeRateLimiter
        );

        Ok(())
    }

    fn get_base_fee_numerator_from_included_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
        included_fee_amount: u64,
    ) -> Result<u64> {
        if self.is_rate_limiter_applied(current_point, activation_point, trade_direction)? {
            self.get_fee_numerator_from_included_fee_amount(included_fee_amount)
        } else {
            Ok(self.cliff_fee_numerator)
        }
    }

    fn get_base_fee_numerator_from_excluded_fee_amount(
        &self,
        current_point: u64,
        activation_point: u64,
        trade_direction: TradeDirection,
        excluded_fee_amount: u64,
    ) -> Result<u64> {
        if self.is_rate_limiter_applied(current_point, activation_point, trade_direction)? {
            self.get_fee_numerator_from_excluded_fee_amount(excluded_fee_amount)
        } else {
            Ok(self.cliff_fee_numerator)
        }
    }
}
