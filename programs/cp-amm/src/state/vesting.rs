use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

use crate::safe_math::SafeMath;

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct Vesting {
    pub position: Pubkey,
    pub cliff_point: u64,
    pub period_frequency: u64,
    pub cliff_unlock_liquidity: u128,
    pub liquidity_per_period: u128,
    pub total_released_liquidity: u128,
    pub number_of_period: u16,
    pub padding: [u8; 14],
    pub padding2: [u128; 4],
}

const_assert_eq!(Vesting::INIT_SPACE, 176);

impl Vesting {
    pub fn initialize(
        &mut self,
        position: Pubkey,
        cliff_point: u64,
        period_frequency: u64,
        cliff_unlock_liquidity: u128,
        liquidity_per_period: u128,
        number_of_period: u16,
    ) {
        self.position = position;
        self.cliff_point = cliff_point;
        self.period_frequency = period_frequency;
        self.cliff_unlock_liquidity = cliff_unlock_liquidity;
        self.liquidity_per_period = liquidity_per_period;
        self.number_of_period = number_of_period;
    }

    pub fn calculate_total_lock_amount(
        cliff_unlock_liquidity: u128,
        liquidity_per_period: u128,
        number_of_period: u16,
    ) -> Result<u128> {
        let total_amount = cliff_unlock_liquidity
            .safe_add(liquidity_per_period.safe_mul(number_of_period.into())?)?;

        Ok(total_amount)
    }

    pub fn get_total_lock_amount(&self) -> Result<u128> {
        Self::calculate_total_lock_amount(
            self.cliff_unlock_liquidity,
            self.liquidity_per_period,
            self.number_of_period,
        )
    }

    pub fn calculate_max_unlocked_liquidity(
        current_point: u64,
        cliff_point: u64,
        period_frequency: u64,
        number_of_period: u16,
        cliff_unlock_liquidity: u128,
        liquidity_per_period: u128,
    ) -> Result<u128> {
        if current_point < cliff_point {
            return Ok(0);
        }

        if period_frequency == 0 {
            return Ok(cliff_unlock_liquidity);
        }

        let period = current_point
            .safe_sub(cliff_point)?
            .safe_div(period_frequency)?;

        let period: u128 = period.min(number_of_period.into()).into();

        let unlocked_liquidity =
            cliff_unlock_liquidity.safe_add(period.safe_mul(liquidity_per_period)?)?;

        Ok(unlocked_liquidity)
    }

    pub fn get_max_unlocked_liquidity(&self, current_point: u64) -> Result<u128> {
        Self::calculate_max_unlocked_liquidity(
            current_point,
            self.cliff_point,
            self.period_frequency,
            self.number_of_period,
            self.cliff_unlock_liquidity,
            self.liquidity_per_period,
        )
    }

    pub fn calculate_new_release_liquidity(
        current_point: u64,
        cliff_point: u64,
        period_frequency: u64,
        number_of_period: u16,
        cliff_unlock_liquidity: u128,
        liquidity_per_period: u128,
        total_released_liquidity: u128,
    ) -> Result<u128> {
        let unlocked_liquidity = Self::calculate_max_unlocked_liquidity(
            current_point,
            cliff_point,
            period_frequency,
            number_of_period,
            cliff_unlock_liquidity,
            liquidity_per_period,
        )?;
        let new_releasing_liquidity = unlocked_liquidity.safe_sub(total_released_liquidity)?;
        Ok(new_releasing_liquidity)
    }

    pub fn get_new_release_liquidity(&self, current_point: u64) -> Result<u128> {
        Self::calculate_new_release_liquidity(
            current_point,
            self.cliff_point,
            self.period_frequency,
            self.number_of_period,
            self.cliff_unlock_liquidity,
            self.liquidity_per_period,
            self.total_released_liquidity,
        )
    }

    pub fn accumulate_released_liquidity(&mut self, released_liquidity: u128) -> Result<()> {
        self.total_released_liquidity =
            self.total_released_liquidity.safe_add(released_liquidity)?;
        Ok(())
    }

    pub fn done(&self) -> Result<bool> {
        Ok(self.total_released_liquidity == self.get_total_lock_amount()?)
    }
}
