//! Event module includes information about events of the program
use anchor_lang::prelude::*;

use crate::{
    params::pool_fees::PoolFeeParamters, state::SwapResult, AddLiquidityParameters,
    RemoveLiquidityParameters, SwapParameters,
};

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
    pub pool_fees: PoolFeeParamters,
    pub vault_config_key: Pubkey,
    pub pool_creator_authority: Pubkey,
    pub activation_type: u8,
    pub sqrt_min_price: u128,
    pub sqrt_max_price: u128,
    pub collect_fee_mode: u8,
    pub index: u64,
    pub config: Pubkey,
}

/// Create token badge
#[event]
pub struct EvtCreateTokenBadge {
    pub token_mint: Pubkey,
}

#[event]
pub struct EvtInitializePool {
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub creator: Pubkey,
    pub payer: Pubkey,
    pub alpha_vault: Pubkey,
    pub pool_fees: PoolFeeParamters,
    pub sqrt_min_price: u128,
    pub sqrt_max_price: u128,
    pub activation_type: u8,
    pub collect_fee_mode: u8,
    pub liquidity: u128,
    pub sqrt_price: u128,
    pub activation_point: u64,
    pub token_a_flag: u8,
    pub token_b_flag: u8,
    pub total_amount_a: u64,
    pub total_amount_b: u64,
    pub pool_type: u8,
}

#[event]
pub struct EvtAddLiquidity {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub params: AddLiquidityParameters,
    pub total_amount_a: u64,
    pub total_amount_b: u64,
}

#[event]
pub struct EvtClaimPositionFee {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub fee_a_pending: u64,
    pub fee_b_pending: u64,
}

#[event]
pub struct EvtCreatePosition {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub operator: Pubkey,
    pub fee_claimer: Pubkey,
    pub liquidity: u128,
}

#[event]
pub struct EvtRemoveLiquidity {
    pub pool: Pubkey,
    pub position: Pubkey,
    pub owner: Pubkey,
    pub params: RemoveLiquidityParameters,
    pub amount_a: u64,
    pub amount_b: u64,
}

#[event]
pub struct EvtSwap {
    pub pool: Pubkey,
    pub trade_direction: u8,
    pub is_referral: bool,
    pub params: SwapParameters,
    pub swap_result: SwapResult,
    pub total_amount_in: u64,
    pub current_timestamp: u64,
}
