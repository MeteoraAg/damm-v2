use anchor_lang::prelude::*;

use crate::{
    constants::LIQUIDITY_MAX,
    safe_math::SafeMath,
    u128x128_math::{mul_div, Rounding},
    PoolError,
};

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct Position {
    pub pool: Pubkey,
    /// Owner
    pub owner: Pubkey,
    /// Operator of position
    pub operator: Pubkey,
    /// Fee claimer for this position
    pub fee_claimer: Pubkey,
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
    // TODO implement locking here
}
impl Position {
    pub fn initialize(
        &mut self,
        pool: Pubkey,
        owner: Pubkey,
        operator: Pubkey,
        fee_claimer: Pubkey,
        liquidity: u128,
    ) {
        self.pool = pool;
        self.owner = owner;
        self.operator = operator;
        self.fee_claimer = fee_claimer;
        self.liquidity = liquidity;
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
