//! Fees module includes information about fee charges
use crate::constants::fee::{FEE_DENOMINATOR, MAX_BASIS_POINT};
use crate::constants::{self, BASIS_POINT_MAX, U24_MAX};
use crate::error::PoolError;
use crate::safe_math::SafeMath;
use anchor_lang::prelude::*;
use std::convert::TryFrom;

use super::swap::TradeDirection;

/// Information regarding fee charges
#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct PoolFees {
    /// Trade fees are extra token amounts that are held inside the token
    /// accounts during a trade, making the value of liquidity tokens rise.
    /// Trade fee numerator
    pub trade_fee_numerator: u64,
    /// Protocol trading fees are extra token amounts that are held inside the token
    /// accounts during a trade, with the equivalent in pool tokens minted to
    /// the protocol of the program.
    /// Protocol trade fee numerator 
    pub protocol_fee_percent: u8,
    /// partner fee
    pub partner_fee_percent: u8,
    /// referral fee
    pub referral_fee_percent: u8,

    /// dynamic fee
    pub dynamic_fee: Option<DynamicFee>,
}

#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct DynamicFee {
    pub bin_step: u16,
    pub bin_step_u128: u128,
    pub filter_period: u16,
    pub decay_period: u16,
    pub reduction_factor: u16,
    pub max_volatility_accumulator: u32,
    pub variable_fee_control: u32,
}

impl DynamicFee {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.bin_step > 0 && self.bin_step <= 400,
            PoolError::InvalidInput
        );

        let bin_step_u128 = (self.bin_step as u128)
            .safe_shl(64)?
            .safe_div(BASIS_POINT_MAX.into())?;
        require!(bin_step_u128 == self.bin_step_u128, PoolError::InvalidInput);

        // filter period < t < decay period
        require!(
            self.filter_period < self.decay_period,
            PoolError::InvalidInput
        );

        // reduction factor decide the decay rate of variable fee, max reduction_factor is BASIS_POINT_MAX = 100% reduction
        require!(
            self.reduction_factor <= BASIS_POINT_MAX as u16,
            PoolError::InvalidInput
        );

        // prevent program overflow
        require!(
            self.variable_fee_control <= U24_MAX,
            PoolError::InvalidInput
        );
        require!(
            self.max_volatility_accumulator <= U24_MAX,
            PoolError::InvalidInput
        );

        Ok(())
    }
}

/// Helper function for calculating swap fee
pub fn calculate_fee(
    token_amount: u128,
    fee_numerator: u128,
    fee_denominator: u128,
) -> Option<u128> {
    if fee_numerator == 0 || token_amount == 0 {
        Some(0)
    } else {
        let fee = token_amount
            .checked_mul(fee_numerator)?
            .checked_div(fee_denominator)?;
        if fee == 0 {
            Some(1) // minimum fee of one token
        } else {
            Some(fee)
        }
    }
}

pub fn validate_fee_fraction(numerator: u64, denominator: u64) -> Result<()> {
    if denominator == 0 || numerator >= denominator {
        Err(PoolError::InvalidFee.into())
    } else {
        Ok(())
    }
}

/// Convert fees numerator and denominator to BPS. Minimum 1 bps, Maximum 10_000 bps. 0.01% -> 100%
pub fn to_bps(numerator: u128, denominator: u128) -> Option<u64> {
    let bps = numerator
        .checked_mul(MAX_BASIS_POINT.into())?
        .checked_div(denominator)?;
    bps.try_into().ok()
}

impl PoolFees {
    /// Calculate the host trading fee in trading tokens
    pub fn host_trading_fee(trading_tokens: u128) -> Option<u128> {
        // Floor division
        trading_tokens
            .checked_mul(constants::fee::HOST_TRADE_FEE_NUMERATOR.into())?
            .checked_div(constants::fee::FEE_DENOMINATOR.into())
    }

    /// Calculate the trading fee in trading tokens
    pub fn trading_fee(&self, trading_tokens: u128) -> Option<u128> {
        calculate_fee(
            trading_tokens,
            u128::try_from(self.trade_fee_numerator).ok()?,
            u128::try_from(FEE_DENOMINATOR).ok()?,
        )
    }

    /// Calculate the protocol trading fee in trading tokens
    pub fn protocol_trading_fee(&self, trading_tokens: u128) -> Option<u128> {
        calculate_fee(
            trading_tokens,
            u128::try_from(self.protocol_fee_percent).ok()?,
            100,
        )
    }

    /// Validate that the fees are reasonable
    pub fn validate(&self) -> Result<()> {
        validate_fee_fraction(self.trade_fee_numerator, FEE_DENOMINATOR)?;
        validate_fee_fraction(self.protocol_fee_percent.into(), 100)?;
        validate_fee_fraction(self.partner_fee_percent.into(), 100)?;
        validate_fee_fraction(self.referral_fee_percent.into(), 100)?;

        let trade_fee_bps = to_bps(self.trade_fee_numerator.into(), FEE_DENOMINATOR.into())
            .ok_or(PoolError::MathOverflow)?;

        if trade_fee_bps > constants::fee::MAX_FEE_BPS {
            return Err(PoolError::ExceedMaxFeeBps.into());
        }

        if let Some(dynamic_fee) = self.dynamic_fee {
            dynamic_fee.validate()?;
        }
        Ok(())
    }
}

#[derive(Copy, Clone, Debug, AnchorSerialize, AnchorDeserialize, InitSpace, Default)]
pub struct PartnerInfo {
    pub fee_percent: u8,
    pub partner_authority: Pubkey,
    pub pending_fee_a: u64,
    pub pending_fee_b: u64,
}

impl PartnerInfo {
    pub fn have_partner(&self) -> bool {
        self.partner_authority != Pubkey::default()
    }

    pub fn validate(&self) -> Result<()> {
        if self.have_partner() {
            require!(self.fee_percent <= 100, PoolError::InvalidFee);
        } else {
            require!(self.fee_percent == 0, PoolError::InvalidFee);
        }

        validate_fee_fraction(self.fee_percent.into(), 100)
    }

    pub fn accrue_partner_fees(
        &mut self,
        protocol_fee: u64,
        trade_direction: TradeDirection,
    ) -> Result<()> {
        if self.fee_percent > 0 {
            let partner_profit = protocol_fee
                .safe_mul(self.fee_percent.into())?
                .safe_div(100)?;

            match trade_direction {
                TradeDirection::AtoB => {
                    self.pending_fee_a = self.pending_fee_a.safe_add(partner_profit)?;
                }
                TradeDirection::BtoA => {
                    self.pending_fee_b = self.pending_fee_b.safe_add(partner_profit)?;
                }
            }
        }
        Ok(())
    }

    pub fn claim_fees(&mut self, max_amount_a: u64, max_amount_b: u64) -> Result<(u64, u64)> {
        let claimable_amount_a = max_amount_a.min(self.pending_fee_a);
        let claimable_amount_b = max_amount_b.min(self.pending_fee_b);

        self.pending_fee_a = self.pending_fee_a.safe_sub(claimable_amount_a)?;
        self.pending_fee_b = self.pending_fee_b.safe_sub(claimable_amount_b)?;

        Ok((claimable_amount_a, claimable_amount_b))
    }
}
