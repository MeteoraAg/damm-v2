use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;
use std::{cell::RefMut, u64};

use crate::{
    constants::{LIQUIDITY_SCALE, NUM_REWARDS, SCALE_OFFSET},
    safe_math::SafeMath,
    state::Pool,
    utils_math::safe_mul_shr_cast,
    PoolError,
};

#[zero_copy]
#[derive(Default, Debug, AnchorDeserialize, AnchorSerialize, InitSpace, PartialEq)]
pub struct UserRewardInfo {
    /// The latest update reward checkpoint
    pub reward_per_token_checkpoint: u128,
    /// Current pending rewards
    pub reward_pendings: u64,
    /// Total claimed rewards
    pub total_claimed_rewards: u64,
}

const_assert_eq!(UserRewardInfo::INIT_SPACE, 32);

impl UserRewardInfo {
    pub fn update_rewards(
        &mut self,
        total_liquidity: u128,
        reward_per_token_stored: u128,
    ) -> Result<()> {
        let new_reward: u64 = safe_mul_shr_cast(
            total_liquidity,
            reward_per_token_stored.safe_sub(self.reward_per_token_checkpoint)?,
            SCALE_OFFSET * 2,
        )?;

        self.reward_pendings = new_reward.safe_add(self.reward_pendings)?;

        self.reward_per_token_checkpoint = reward_per_token_stored;

        Ok(())
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
    /// unlock liquidity
    pub unlocked_liquidity: u128,
    /// vesting liquidity
    pub vested_liquidity: u128,
    /// permanent locked liquidity
    pub permanent_locked_liquidity: u128,
    /// metrics
    pub metrics: PositionMetrics,
    /// Farming reward information
    pub reward_infos: [UserRewardInfo; NUM_REWARDS],
    /// Operator of position
    pub operator: Pubkey,
    /// Fee claimer for this position
    pub fee_claimer: Pubkey,
    /// padding for future usage
    pub padding: [u128; 4],
    // TODO implement locking here
}

const_assert_eq!(Position::INIT_SPACE, 368);

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct PositionMetrics {
    pub total_claimed_a_fee: u64,
    pub total_claimed_b_fee: u64,
}

const_assert_eq!(PositionMetrics::INIT_SPACE, 16);

impl PositionMetrics {
    pub fn accumulate_claimed_fee(
        &mut self,
        token_a_amount: u64,
        token_b_amount: u64,
    ) -> Result<()> {
        self.total_claimed_a_fee = self.total_claimed_a_fee.safe_add(token_a_amount)?;
        self.total_claimed_b_fee = self.total_claimed_b_fee.safe_add(token_b_amount)?;
        Ok(())
    }
}

impl Position {
    pub fn initialize(
        &mut self,
        pool_state: &mut Pool,
        pool: Pubkey,
        owner: Pubkey,
        liquidity: u128,
    ) -> Result<()> {
        pool_state.metrics.inc_position()?;
        self.pool = pool;
        self.owner = owner;
        self.unlocked_liquidity = liquidity;
        Ok(())
    }

    fn has_sufficient_liquidity(&self, liquidity: u128) -> bool {
        self.unlocked_liquidity >= liquidity
    }

    fn get_total_liquidity(&self) -> Result<u128> {
        Ok(self
            .unlocked_liquidity
            .safe_add(self.vested_liquidity)?
            .safe_add(self.permanent_locked_liquidity)?)
    }

    pub fn lock(&mut self, total_lock_liquidity: u128) -> Result<()> {
        require!(
            self.has_sufficient_liquidity(total_lock_liquidity),
            PoolError::InsufficientLiquidity
        );

        self.remove_unlocked_liquidity(total_lock_liquidity)?;
        self.vested_liquidity = self.vested_liquidity.safe_add(total_lock_liquidity)?;

        Ok(())
    }

    pub fn permanent_lock_liquidity(&mut self, permanent_lock_liquidity: u128) -> Result<()> {
        require!(
            self.has_sufficient_liquidity(permanent_lock_liquidity),
            PoolError::InsufficientLiquidity
        );

        self.remove_unlocked_liquidity(permanent_lock_liquidity)?;
        self.permanent_locked_liquidity = self
            .permanent_locked_liquidity
            .safe_add(permanent_lock_liquidity)?;

        Ok(())
    }

    pub fn update_fee(
        &mut self,
        fee_a_per_token_stored: u128,
        fee_b_per_token_stored: u128,
    ) -> Result<()> {
        let liquidity = self.get_total_liquidity()?;
        if liquidity > 0 {
            let new_fee_a: u64 = safe_mul_shr_cast(
                liquidity,
                fee_a_per_token_stored.safe_sub(self.fee_a_per_token_checkpoint)?,
                LIQUIDITY_SCALE,
            )?;

            self.fee_a_pending = new_fee_a.safe_add(self.fee_a_pending)?;

            let new_fee_b: u64 = safe_mul_shr_cast(
                liquidity,
                fee_b_per_token_stored.safe_sub(self.fee_b_per_token_checkpoint)?,
                LIQUIDITY_SCALE,
            )?;

            self.fee_b_pending = new_fee_b.safe_add(self.fee_b_pending)?;
        }
        self.fee_a_per_token_checkpoint = fee_a_per_token_stored;
        self.fee_b_per_token_checkpoint = fee_b_per_token_stored;
        Ok(())
    }

    pub fn release_vested_liquidity(&mut self, released_liquidity: u128) -> Result<()> {
        self.vested_liquidity = self.vested_liquidity.safe_sub(released_liquidity)?;
        self.add_liquidity(released_liquidity)?;
        Ok(())
    }

    pub fn add_liquidity(&mut self, liquidity_delta: u128) -> Result<()> {
        self.unlocked_liquidity = self.unlocked_liquidity.safe_add(liquidity_delta)?;
        Ok(())
    }

    pub fn remove_unlocked_liquidity(&mut self, liquidity_delta: u128) -> Result<()> {
        self.unlocked_liquidity = self.unlocked_liquidity.safe_sub(liquidity_delta)?;
        Ok(())
    }

    pub fn reset_pending_fee(&mut self) {
        self.fee_a_pending = 0;
        self.fee_b_pending = 0;
    }

    pub fn update_rewards(&mut self, pool: &mut RefMut<'_, Pool>, current_time: u64) -> Result<()> {
        // update if reward has been initialized
        if pool.pool_reward_initialized() {
            // update pool reward before any update about position reward
            pool.update_rewards(current_time)?;

            let total_liquidity = self.get_total_liquidity()?;
            let position_reward_infos = &mut self.reward_infos;
            for reward_idx in 0..NUM_REWARDS {
                let pool_reward_info = pool.reward_infos[reward_idx];

                if pool_reward_info.initialized() {
                    let reward_per_token_stored = pool_reward_info.reward_per_token_stored;
                    position_reward_infos[reward_idx]
                        .update_rewards(total_liquidity, reward_per_token_stored)?;
                }
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

    pub fn reset_all_pending_reward(&mut self, reward_index: usize) {
        self.reward_infos[reward_index].reward_pendings = 0;
    }
}
