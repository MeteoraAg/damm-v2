pub mod ix_swap;
pub use ix_swap::*;

pub mod ix_p_swap;
pub use ix_p_swap::*;

pub mod swap_exact_in;
pub use swap_exact_in::*;

pub mod swap_partial_fill;
pub use swap_partial_fill::*;

pub mod swap_exact_out;
pub use swap_exact_out::*;

use crate::{
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool, SwapResult2},
};

pub struct ProcessSwapParams<'a> {
    pub pool: &'a Pool,
    pub token_in_mint: &'a pinocchio::account_info::AccountInfo,
    pub token_out_mint: &'a pinocchio::account_info::AccountInfo,
    pub fee_mode: &'a FeeMode,
    pub trade_direction: TradeDirection,
    pub current_point: u64,
    pub amount_0: u64,
    pub amount_1: u64,
}

pub struct ProcessSwapResult {
    swap_result: SwapResult2,
    swap_in_parameters: SwapParameters,
    included_transfer_fee_amount_in: u64,
    included_transfer_fee_amount_out: u64,
    excluded_transfer_fee_amount_out: u64,
}
