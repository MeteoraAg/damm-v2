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

    pub fn get_total_lock_amount(&self) -> Result<u128> {
        let total_amount = self.cliff_unlock_liquidity.safe_add(
            self.liquidity_per_period
                .safe_mul(self.number_of_period.into())?,
        )?;

        Ok(total_amount)
    }

    pub fn get_max_unlocked_liquidity(&self, current_point: u64) -> Result<u128> {
        if current_point < self.cliff_point {
            return Ok(0);
        }

        if self.period_frequency == 0 {
            return Ok(self.cliff_unlock_liquidity);
        }

        let period = current_point
            .safe_sub(self.cliff_point)?
            .safe_div(self.period_frequency)?;

        let period: u128 = period.min(self.number_of_period.into()).into();

        let unlocked_liquidity = self
            .cliff_unlock_liquidity
            .safe_add(period.safe_mul(self.liquidity_per_period)?)?;

        Ok(unlocked_liquidity)
    }

    pub fn get_new_release_liquidity(&self, current_point: u64) -> Result<u128> {
        let unlocked_liquidity = self.get_max_unlocked_liquidity(current_point)?;
        let new_releasing_liquidity = unlocked_liquidity.safe_sub(self.total_released_liquidity)?;
        Ok(new_releasing_liquidity)
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
