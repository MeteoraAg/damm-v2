use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use std::convert::TryFrom;

use crate::{constants::activation::*, math::safe_math::SafeMath, PoolError};

#[derive(
    Copy,
    Clone,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    IntoPrimitive,
    TryFromPrimitive,
)]
#[repr(u8)]
/// Type of the activation
pub enum ActivationType {
    Slot,
    Timestamp,
}

pub struct ActivationHandler {
    /// current slot or current timestamp
    pub curr_point: u64,
    /// activation slot or activation timestamp
    pub activation_point: u64,
    /// buffer duration
    pub buffer_duration: u64,
    /// whitelisted vault
    pub whitelisted_vault: Pubkey,
}

impl ActivationHandler {
    pub fn get_current_point(activation_type: u8) -> Result<u64> {
        let activation_type = ActivationType::try_from(activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let current_point = match activation_type {
            ActivationType::Slot => Clock::get()?.slot,
            ActivationType::Timestamp => Clock::get()?.unix_timestamp as u64,
        };
        Ok(current_point)
    }

    pub fn get_current_point_and_max_vesting_duration(activation_type: u8) -> Result<(u64, u64)> {
        let activation_type = ActivationType::try_from(activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let (curr_point, max_vesting_duration) = match activation_type {
            ActivationType::Slot => (Clock::get()?.slot, MAX_VESTING_SLOT_DURATION),
            ActivationType::Timestamp => (
                Clock::get()?.unix_timestamp as u64,
                MAX_VESTING_TIME_DURATION,
            ),
        };
        Ok((curr_point, max_vesting_duration))
    }

    pub fn get_current_point_and_buffer_duration(activation_type: u8) -> Result<(u64, u64)> {
        let activation_type = ActivationType::try_from(activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let (curr_point, buffer_duration) = match activation_type {
            ActivationType::Slot => (Clock::get()?.slot, SLOT_BUFFER),
            ActivationType::Timestamp => (Clock::get()?.unix_timestamp as u64, TIME_BUFFER),
        };
        Ok((curr_point, buffer_duration))
    }

    pub fn get_max_activation_point(activation_type: u8) -> Result<u64> {
        let activation_type = ActivationType::try_from(activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let (curr_point, max_activation_duration) = match activation_type {
            ActivationType::Slot => (Clock::get()?.slot, MAX_ACTIVATION_SLOT_DURATION),
            ActivationType::Timestamp => (
                Clock::get()?.unix_timestamp as u64,
                MAX_ACTIVATION_TIME_DURATION,
            ),
        };
        Ok(curr_point.safe_add(max_activation_duration)?)
    }

    pub fn get_last_buying_point(&self) -> Result<u64> {
        let last_buying_slot = self.activation_point.safe_sub(1)?;
        Ok(last_buying_slot)
    }

    pub fn get_pre_activation_start_point(&self) -> Result<u64> {
        Ok(self.activation_point.safe_sub(self.buffer_duration)?)
    }

    /// last join pool from alpha-vault
    pub fn get_last_join_point(&self) -> Result<u64> {
        let pre_activation_start_point = self.get_pre_activation_start_point()?;
        let last_join_point =
            pre_activation_start_point.safe_sub(self.buffer_duration.safe_div(12)?)?; // 5 minutes
        Ok(last_join_point)
    }

    pub fn is_launch_pool(&self) -> bool {
        self.whitelisted_vault.ne(&Pubkey::default())
    }

    pub fn validate_remove_balanced_liquidity(&self) -> Result<()> {
        require!(
            self.curr_point >= self.activation_point,
            PoolError::PoolDisabled
        );
        Ok(())
    }

    pub fn validate_swap(&self, sender: Pubkey) -> Result<()> {
        if sender == self.whitelisted_vault {
            require!(
                self.is_launch_pool()
                    && self.curr_point >= self.get_pre_activation_start_point()?
                    && self.curr_point <= self.get_last_buying_point()?,
                PoolError::PoolDisabled
            );
        } else {
            require!(
                self.curr_point >= self.activation_point,
                PoolError::PoolDisabled
            );
        }
        Ok(())
    }

    pub fn validate_update_activation_point(&self, new_activation_point: u64) -> Result<()> {
        let nearest_new_activation_point = self.curr_point.safe_add(self.buffer_duration)?;
        require!(
            new_activation_point > nearest_new_activation_point
                && self.activation_point > self.curr_point,
            PoolError::UnableToModifyActivationPoint
        );

        if self.is_launch_pool() {
            // Don't allow update when the pool already enter pre-activation phase
            require!(
                self.curr_point < self.get_pre_activation_start_point()?,
                PoolError::UnableToModifyActivationPoint
            );

            let new_pre_activation_start_point =
                new_activation_point.safe_sub(self.buffer_duration)?;
            let buffered_new_pre_activation_start_point =
                new_pre_activation_start_point.safe_sub(self.buffer_duration)?;

            // Prevent update of activation point causes the pool enter pre-activation phase immediately, no time buffer for any correction as the crank will swap it
            require!(
                self.curr_point < buffered_new_pre_activation_start_point,
                PoolError::UnableToModifyActivationPoint
            );
        }

        Ok(())
    }
}
