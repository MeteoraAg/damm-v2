//! Event module includes information about events of the program
use anchor_lang::prelude::*;

use crate::params::pool_fees::PoolFees;

// use crate::state::FeeCurveInfoFromDuration;

/// Close config
#[event]
pub struct EvtCloseConfig {
    /// Config pubkey
    pub config: Pubkey,
    /// admin pk
    pub admin: Pubkey,
}

/// Create config
#[event]
pub struct EvtCreateConfig {
    pub pool_fees: PoolFees,
    pub vault_config_key: Pubkey,
    pub pool_creator_authority: Pubkey,
    pub activation_type: u8,
    // pub fee_curve: FeeCurveInfoFromDuration, // TODO add this field
    pub index: u64,
    pub config: Pubkey,
}

// Initialize reward
#[event]
pub struct EvtInitializeReward {
    // Liquidity pool
    pub pool: Pubkey,
    // Mint address of the farm reward
    pub reward_mint: Pubkey,
    // Address of the funder
    pub funder: Pubkey,
    // Index of the farm reward being initialized
    pub reward_index: u64,
    // Duration of the farm reward in seconds
    pub reward_duration: u64,
}

#[event]
pub struct EvtFundReward {
    // Liquidity pool 
    pub pool: Pubkey,
    // Address of the funder
    pub funder: Pubkey,
    // Index of the farm reward being funded
    pub reward_index: u64,
    // Amount of farm reward funded
    pub amount: u64,
}

#[event]
pub struct EvtClaimReward {
    // Liquidity pool
    pub pool: Pubkey,
    // Position address
    pub position: Pubkey,
    // Owner of the position
    pub owner: Pubkey,
    // Index of the farm reward the owner is claiming
    pub reward_index: u64,
    // Total amount of reward claimed
    pub total_reward: u64,
}