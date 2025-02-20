use std::cell::RefMut;

use anchor_lang::prelude::*;

use crate::{
    constants::{ LIQUIDITY_MAX, NUM_REWARDS },
    safe_math::SafeMath,
    u128x128_math::{ mul_div, Rounding },
    PoolError,
};

use super::Pool;

#[zero_copy]
#[derive(Default, Debug, AnchorDeserialize, AnchorSerialize, InitSpace, PartialEq)]
pub struct UserRewardInfo {
    /// The latest update reward checkpoint
    pub reward_per_token_checkpoint: u128,
    /// Current pendings reward
    pub reward_pendings: u64,
    /// Total claimed rewards
    pub total_claimed_rewards: u64,
}

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
    /// Farming reward information
    pub reward_infos: [UserRewardInfo; NUM_REWARDS],
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
        liquidity: u128
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
        fee_b_per_token_stored: u128
    ) -> Result<()> {
        if self.liquidity > 0 {
            let new_fee_a: u64 = mul_div(
                self.liquidity,
                fee_a_per_token_stored.safe_sub(self.fee_a_per_token_checkpoint)?,
                LIQUIDITY_MAX,
                Rounding::Down
            )
                .unwrap()
                .try_into()
                .map_err(|_| PoolError::TypeCastFailed)?;

            self.fee_a_pending = new_fee_a.safe_add(self.fee_a_pending)?;

            let new_fee_b: u64 = mul_div(
                self.liquidity,
                fee_b_per_token_stored.safe_sub(self.fee_b_per_token_checkpoint)?,
                LIQUIDITY_MAX,
                Rounding::Down
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

    pub fn update_reward(&mut self, pool: &mut RefMut<'_, Pool>, current_time: u64) -> Result<()> {
        // skip if rewards are not initialized
        if !pool.pool_reward_initialized() {
            return Ok(());
        }
        // update pool reward before any update about position reward
        pool.update_rewards(current_time)?;

        //
        let position_reward_info = &mut self.reward_infos;
        for reward_idx in 0..NUM_REWARDS {
            let pool_reward_info = pool.reward_infos[reward_idx];

            if pool_reward_info.initialized() {
                let reward_per_token_stored = pool_reward_info.reward_per_token_stored;

                let new_reward: u64 = mul_div(
                    self.liquidity,
                    reward_per_token_stored.safe_sub(
                        position_reward_info[reward_idx].reward_per_token_checkpoint
                    )?,
                    LIQUIDITY_MAX,
                    Rounding::Down
                )
                    .unwrap()
                    .try_into()
                    .map_err(|_| PoolError::TypeCastFailed)?;

                position_reward_info[reward_idx].reward_pendings = new_reward.safe_add(
                    position_reward_info[reward_idx].reward_pendings
                )?;

                position_reward_info[reward_idx].reward_per_token_checkpoint =
                    reward_per_token_stored;
            }
        }

        Ok(())
    }

    fn get_total_reward(&self, reward_index: usize) -> Result<u64> {
        Ok(self.reward_infos[reward_index].reward_pendings)
    }

    fn accumulate_total_claimed_rewards(&mut self, reward_index: usize, reward: u64) {
        let total_claimed_reward = self.reward_infos[reward_index].total_claimed_rewards;
        self.reward_infos[reward_index].total_claimed_rewards =
            total_claimed_reward.wrapping_add(reward);
    }

    pub fn claim_reward(&mut self, reward_index: usize) -> Result<u64> {
        let total_reward = self.get_total_reward(reward_index)?;

        self.accumulate_total_claimed_rewards(reward_index, total_reward);

        self.reset_all_pending_reward(reward_index);

        Ok(total_reward)
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

    pub fn reset_all_pending_reward(&mut self, reward_index: usize) {
        self.reward_infos[reward_index].reward_pendings = 0;
    }
}
