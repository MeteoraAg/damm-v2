pub mod compounding_liquidity;
pub use compounding_liquidity::*;

pub mod concentrated_liquidity;
pub use concentrated_liquidity::*;

use anchor_lang::prelude::*;

#[cfg(test)]
use crate::params::swap::TradeDirection;
use crate::{
    state::{CollectFeeMode, SwapAmountFromInput, SwapAmountFromOutput},
    u128x128_math::Rounding,
};

pub trait LiquidityHandler {
    fn get_amounts_for_modify_liquidity(
        &self,
        liquidity_delta: u128,
        round: Rounding,
    ) -> Result<(u64, u64)>;

    fn calculate_a_to_b_from_amount_in(&self, amount_in: u64) -> Result<SwapAmountFromInput>;

    fn calculate_b_to_a_from_amount_in(&self, amount_in: u64) -> Result<SwapAmountFromInput>;

    fn calculate_a_to_b_from_partial_amount_in(
        &self,
        amount_in: u64,
    ) -> Result<SwapAmountFromInput>;

    fn calculate_b_to_a_from_partial_amount_in(
        &self,
        amount_in: u64,
    ) -> Result<SwapAmountFromInput>;

    fn calculate_a_to_b_from_amount_out(&self, amount_out: u64) -> Result<SwapAmountFromOutput>;

    fn calculate_b_to_a_from_amount_out(&self, amount_out: u64) -> Result<SwapAmountFromOutput>;

    fn get_reserves_amount(&self) -> Result<(u64, u64)>;

    fn get_next_sqrt_price(&self, next_sqrt_price: u128) -> Result<u128>;

    #[cfg(test)]
    fn get_max_amount_in(&self, trade_direction: TradeDirection) -> Result<u64>;
}

#[derive(Debug)]
pub struct InitialPoolInformation {
    pub token_a_amount: u64,
    pub token_b_amount: u64,
    pub sqrt_price: u128,
    pub initial_liquidity: u128,
    pub sqrt_min_price: u128,
    pub sqrt_max_price: u128,
}

pub fn get_initial_pool_information(
    collect_fee_mode: CollectFeeMode,
    sqrt_min_price: u128,
    sqrt_max_price: u128,
    sqrt_price: u128,
    liquidity: u128,
) -> Result<InitialPoolInformation> {
    if collect_fee_mode == CollectFeeMode::Compounding {
        CompoundingLiquidity::get_initial_pool_information(sqrt_price, liquidity)
    } else {
        ConcenstratedLiquidity::get_initial_pool_information(
            sqrt_min_price,
            sqrt_max_price,
            sqrt_price,
            liquidity,
        )
    }
}
