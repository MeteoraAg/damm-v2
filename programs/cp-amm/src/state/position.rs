use std::u64;

use anchor_lang::prelude::*;

use crate::{
    constants::{fee::MAX_BASIS_POINT, LIQUIDITY_MAX},
    safe_math::SafeMath,
    u128x128_math::{mul_div, Rounding},
    PoolError,
};

#[zero_copy]
#[derive(InitSpace, Debug, Default)]
pub struct VestingInfo {
    pub locked_liquidity: u128,
    pub cliff_point: u64,
    pub period_frequency: u64,
    pub cliff_unlock_bps: u16,
    pub unlock_bps_per_period: u16,
    pub number_of_period: u16,
    pub padding: u16,
}

impl VestingInfo {
    pub fn initialize(
        &mut self,
        cliff_point: u64,
        period_frequency: u64,
        cliff_unlock_bps: u16,
        unlock_bps_per_period: u16,
        number_of_period: u16,
        locked_liquidity: u128,
    ) {
        self.locked_liquidity = locked_liquidity;
        self.cliff_point = cliff_point;
        self.period_frequency = period_frequency;
        self.cliff_unlock_bps = cliff_unlock_bps;
        self.unlock_bps_per_period = unlock_bps_per_period;
        self.number_of_period = number_of_period;
    }
}

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct Position {
    pub pool: Pubkey,
    /// Owner
    pub owner: Pubkey,
    /// fee a checkpoint
    pub fee_a_per_token_checkpoint: u128,
    /// fee b checkpoint
    pub fee_b_per_token_checkpoint: u128,
    /// fee a pending
    pub fee_a_pending: u64,
    /// fee b pending
    pub fee_b_pending: u64,
    /// liquidity share
    pub liquidity: u128,
    pub vesting_info: VestingInfo,
}
impl Position {
    pub fn initialize(&mut self, pool: Pubkey, owner: Pubkey, liquidity: u128) {
        self.pool = pool;
        self.owner = owner;
        self.liquidity = liquidity;
    }

    pub fn lock(
        &mut self,
        cliff_point: u64,
        period_frequency: u64,
        cliff_unlock_bps: u16,
        unlock_bps_per_period: u16,
        number_of_period: u16,
    ) {
        self.vesting_info.initialize(
            cliff_point,
            period_frequency,
            cliff_unlock_bps,
            unlock_bps_per_period,
            number_of_period,
            self.liquidity,
        );
    }

    fn lock_release_point(&self) -> Result<u64> {
        let last_release_point = self.vesting_info.cliff_point.safe_add(
            self.vesting_info
                .period_frequency
                .safe_mul(self.vesting_info.number_of_period.into())?,
        )?;

        Ok(last_release_point)
    }

    pub fn is_locked(&self, current_point: u64) -> Result<bool> {
        let lock_release_point = self.lock_release_point()?;
        Ok(current_point < lock_release_point)
    }

    pub fn is_permanently_locked(&self) -> bool {
        self.vesting_info.cliff_point == u64::MAX
    }

    pub fn get_withdrawable_liquidity(&self, current_point: u64) -> Result<u128> {
        if !self.is_locked(current_point)? {
            return Ok(self.liquidity);
        }

        let unlocked_liquidity = self.get_max_unlocked_liquidity(current_point)?;

        let new_locked_liquidity = self
            .vesting_info
            .locked_liquidity
            .safe_sub(unlocked_liquidity)?;

        Ok(self.liquidity.safe_sub(new_locked_liquidity)?)
    }

    fn get_max_unlocked_liquidity(&self, current_point: u64) -> Result<u128> {
        let &VestingInfo {
            locked_liquidity,
            cliff_point,
            period_frequency,
            cliff_unlock_bps,
            unlock_bps_per_period,
            number_of_period,
            ..
        } = &self.vesting_info;

        if current_point < cliff_point {
            return Ok(0);
        }

        let period = current_point
            .safe_sub(cliff_point)?
            .safe_div(period_frequency)?;

        msg!("current_point: {}", current_point);
        msg!("cliff_point: {}", cliff_point);
        msg!("period: {}", period);

        let max_period: u64 = number_of_period.into();

        if period >= max_period {
            return Ok(locked_liquidity);
        }

        let unlocked_cliff_liquidity = mul_div(
            locked_liquidity,
            cliff_unlock_bps.into(),
            MAX_BASIS_POINT.into(),
            Rounding::Down,
        )
        .ok_or_else(|| PoolError::MathOverflow)?;

        let unlocked_period_bps = period.safe_mul(unlock_bps_per_period.into())?;

        let unlocked_period_liquidity = mul_div(
            locked_liquidity,
            unlocked_period_bps.into(),
            MAX_BASIS_POINT.into(),
            Rounding::Down,
        )
        .ok_or_else(|| PoolError::MathOverflow)?;

        msg!("unlocked_cliff_liquidity: {}", unlocked_cliff_liquidity);
        msg!("unlocked_period_liquidity: {}", unlocked_period_liquidity);

        let unlocked_liquidity = unlocked_cliff_liquidity.safe_add(unlocked_period_liquidity)?;
        Ok(unlocked_liquidity)
    }

    pub fn update_fee(
        &mut self,
        fee_a_per_token_stored: u128,
        fee_b_per_token_stored: u128,
    ) -> Result<()> {
        if self.liquidity > 0 {
            let new_fee_a: u64 = mul_div(
                self.liquidity,
                fee_a_per_token_stored.safe_sub(self.fee_a_per_token_checkpoint)?,
                LIQUIDITY_MAX,
                Rounding::Down,
            )
            .unwrap()
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?;

            self.fee_a_pending = new_fee_a.safe_add(self.fee_a_pending)?;

            let new_fee_b: u64 = mul_div(
                self.liquidity,
                fee_b_per_token_stored.safe_sub(self.fee_b_per_token_checkpoint)?,
                LIQUIDITY_MAX,
                Rounding::Down,
            )
            .unwrap()
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?;

            self.fee_b_pending = new_fee_b.safe_add(self.fee_b_pending)?;
        }
        self.fee_a_per_token_checkpoint = fee_a_per_token_stored;
        self.fee_b_per_token_checkpoint = fee_b_per_token_stored;
        Ok(())
    }

    pub fn add_liquidity(&mut self, liquidity_delta: u128) -> Result<()> {
        self.liquidity = self.liquidity.safe_add(liquidity_delta)?;
        Ok(())
    }

    pub fn remove_liquidity(&mut self, liquidity_delta: u128) -> Result<()> {
        self.liquidity = self.liquidity.safe_sub(liquidity_delta)?;
        Ok(())
    }

    pub fn reset_pending_fee(&mut self) {
        self.fee_a_pending = 0;
        self.fee_b_pending = 0;
    }
}
