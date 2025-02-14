use anchor_lang::prelude::*;

use crate::{
    constants::{ LIQUIDITY_MAX, NUM_REWARDS, SCALE_OFFSET },
    safe_math::SafeMath,
    u128x128_math::{ mul_div, Rounding },
    utils_math::safe_mul_shr_cast,
    PoolError,
};

use super::Pool;

#[zero_copy]
#[derive(Default, Debug, AnchorDeserialize, AnchorSerialize, InitSpace, PartialEq)]
pub struct UserRewardInfo {
    pub reward_per_token_checkpoint: u128,
    pub reward_pendings: u64,
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
    ///  Liquidity shares of this position. This is the same as LP concept.
    pub liquidity_shares: u64,
    /// Total claimed rewards
    pub total_claimed_rewards: [u64; 2],
    /// liquidity share
    pub liquidity: u128,
    // TODO implement locking here
}

pub trait PositionLiquidityFlowValidator {
    fn validate_outflow_to_ata_of_position_owner(&self, owner: Pubkey) -> Result<()>;
}

impl Position {
    pub fn initialize(
        &mut self,
        pool: Pubkey,
        owner: Pubkey,
        operator: Pubkey,
        fee_claimer: Pubkey,
        liquidity: u128,
        fee_a_per_token_checkpoint: u128,
        fee_b_per_token_checkpoint: u128
    ) {
        self.pool = pool;
        self.owner = owner;
        self.operator = operator;
        self.fee_claimer = fee_claimer;
        self.liquidity = liquidity;
        self.fee_a_per_token_checkpoint = fee_a_per_token_checkpoint;
        self.fee_b_per_token_checkpoint = fee_b_per_token_checkpoint;
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

    /// Update reward + fee earning
    pub fn update_earning_per_token_stored(&mut self, pool: &Pool) -> Result<()> {
        self.update_reward_per_token_stored(pool)?;

        // TODO implement calculate fee per token store
        self.update_fee_per_token_stored()?;

        Ok(())
    }

    fn update_fee_per_token_stored(&mut self) -> Result<()> {
        // TODO: add logic calculate fee per token store

        Ok(())
    }

    fn update_reward_per_token_stored(&mut self, pool: &Pool) -> Result<()> {
        let reward_info = &mut self.reward_infos;
        for reward_idx in 0..NUM_REWARDS {
            let reward_per_token_stored = pool.reward_infos[reward_idx].reward_per_token_stored;

            let new_reward: u64 = safe_mul_shr_cast(
                self.liquidity_shares
                    .safe_shr(SCALE_OFFSET.into())?
                    .try_into()
                    .map_err(|_| PoolError::TypeCastFailed)?,
                reward_per_token_stored.safe_sub(
                    reward_info[reward_idx].reward_per_token_checkpoint
                )?,
                SCALE_OFFSET,
                Rounding::Down
            )?;

            reward_info[reward_idx].reward_pendings = new_reward.safe_add(
                reward_info[reward_idx].reward_pendings
            )?;
            reward_info[reward_idx].reward_per_token_checkpoint = reward_per_token_stored;
        }

        Ok(())
    }

    pub fn get_total_reward(&self, reward_index: usize) -> Result<u64> {
        Ok(self.reward_infos[reward_index].reward_pendings)
    }

    pub fn accumulate_total_claimed_rewards(&mut self, reward_index: usize, reward: u64) {
        let total_claimed_reward = self.total_claimed_rewards[reward_index];
        self.total_claimed_rewards[reward_index] = total_claimed_reward.wrapping_add(reward);
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
