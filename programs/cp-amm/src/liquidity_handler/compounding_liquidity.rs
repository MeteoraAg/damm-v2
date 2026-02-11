#[cfg(test)]
use crate::params::swap::TradeDirection;
use crate::{
    safe_math::{SafeCast, SafeMath},
    state::{SwapAmountFromInput, SwapAmountFromOutput},
    u128x128_math::Rounding,
    utils_math::{safe_mul_div_cast_u128, safe_mul_div_cast_u64, sqrt_u256},
    InitialPoolInformation, LiquidityHandler, PoolError,
};
use anchor_lang::prelude::*;
use ruint::aliases::U256;

pub const DEAD_LIQUIDITY: u128 = 100 << 64;
pub struct CompoundingLiquidity {
    pub token_a_amount: u64, // current token a reserve
    pub token_b_amount: u64, // current token_b_reserve
    pub liquidity: u128,     // current liquidity
}

impl CompoundingLiquidity {
    pub fn get_initial_pool_information(
        sqrt_price: u128,
        liquidity: u128,
    ) -> Result<InitialPoolInformation> {
        require!(
            liquidity >= DEAD_LIQUIDITY,
            PoolError::InvalidMinimumLiquidity
        );
        // a * b = liquidity ^ 2
        // b / a = sqrt_price ^ 2
        // So we can calculate b = liquidity * sqrt_price and a = liquidity / sqrt_price
        let token_a_amount = get_initial_token_a(sqrt_price, liquidity).unwrap();
        let token_b_amount = get_initial_token_b(sqrt_price, liquidity).unwrap();
        Ok(InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            initial_liquidity: liquidity.safe_sub(DEAD_LIQUIDITY)?, // we lock DEAD_LIQUIDITY in pool
            sqrt_min_price: 0,
            sqrt_max_price: u128::MAX,
        })
    }
}

impl LiquidityHandler for CompoundingLiquidity {
    fn get_amounts_for_modify_liquidity(
        &self,
        liquidity_delta: u128,
        round: Rounding,
    ) -> Result<(u64, u64)> {
        let token_a_amount = safe_mul_div_cast_u128(
            liquidity_delta,
            self.token_a_amount.into(),
            self.liquidity,
            round,
        )?;
        let token_b_amount = safe_mul_div_cast_u128(
            liquidity_delta,
            self.token_b_amount.into(),
            self.liquidity,
            round,
        )?;

        Ok((token_a_amount.safe_cast()?, token_b_amount.safe_cast()?))
    }

    fn calculate_a_to_b_from_amount_in(&self, amount_in: u64) -> Result<SwapAmountFromInput> {
        // a * b = (a + amount_in) * (b - output_amount)
        // => output_amount = b - a * b / (a + amount_in) = b * amount_in / (a + amount_in)
        let output_amount = safe_mul_div_cast_u64(
            self.token_b_amount,
            amount_in,
            self.token_a_amount.safe_add(amount_in)?,
            Rounding::Down,
        )?;

        Ok(SwapAmountFromInput {
            amount_left: 0,
            output_amount,
            next_sqrt_price: 0,
        })
    }

    fn calculate_b_to_a_from_amount_in(&self, amount_in: u64) -> Result<SwapAmountFromInput> {
        // a * b = (b + amount_in) * (a - output_amount)
        // => output_amount = a - a * b / (b + amount_in) = a * amount_in / (b + amount_in)
        let output_amount = safe_mul_div_cast_u64(
            self.token_a_amount,
            amount_in,
            self.token_b_amount.safe_add(amount_in)?,
            Rounding::Down,
        )?;

        Ok(SwapAmountFromInput {
            amount_left: 0,
            output_amount,
            next_sqrt_price: 0, // dont need to care for next sqrt price now
        })
    }

    fn calculate_a_to_b_from_partial_amount_in(
        &self,
        amount_in: u64,
    ) -> Result<SwapAmountFromInput> {
        // it is constant-product, so no price range
        self.calculate_a_to_b_from_amount_in(amount_in)
    }

    fn calculate_b_to_a_from_partial_amount_in(
        &self,
        amount_in: u64,
    ) -> Result<SwapAmountFromInput> {
        // it is constant-product, so no price range
        self.calculate_b_to_a_from_amount_in(amount_in)
    }

    fn calculate_a_to_b_from_amount_out(&self, amount_out: u64) -> Result<SwapAmountFromOutput> {
        // a * b = (a + amount_in) * (b - amount_out)
        // => amount_in = a * b / (b - amount_out) - a = a * amount_out / (b - amount_out)
        let input_amount = safe_mul_div_cast_u64(
            self.token_a_amount,
            amount_out,
            self.token_b_amount.safe_sub(amount_out)?,
            Rounding::Up,
        )?;
        Ok(SwapAmountFromOutput {
            input_amount,
            next_sqrt_price: 0, // dont need to care for next sqrt price now
        })
    }

    fn calculate_b_to_a_from_amount_out(&self, amount_out: u64) -> Result<SwapAmountFromOutput> {
        // a * b = (b + amount_in) * (a - amount_out)
        // => amount_in = a * b / (a - amount_out) - b = b * amount_out / (a - amount_out)
        let input_amount = safe_mul_div_cast_u64(
            self.token_b_amount,
            amount_out,
            self.token_a_amount.safe_sub(amount_out)?,
            Rounding::Up,
        )?;
        Ok(SwapAmountFromOutput {
            input_amount,
            next_sqrt_price: 0, // dont need to care for next sqrt price now
        })
    }

    fn get_reserves_amount(&self) -> Result<(u64, u64)> {
        Ok((self.token_a_amount, self.token_b_amount))
    }

    fn get_next_sqrt_price(&self, _next_sqrt_price: u128) -> Result<u128> {
        // b / a = sqrt_price ^ 2 => sqrt_price = sqrt(b/a)
        let token_b_amount = U256::from(self.token_b_amount).safe_shl(128)?;
        let next_price = token_b_amount.safe_div(U256::from(self.token_a_amount))?;
        let next_sqrt_price = sqrt_u256(next_price).ok_or_else(|| PoolError::MathOverflow)?;
        Ok(next_sqrt_price
            .try_into()
            .map_err(|_| PoolError::TypeCastFailed)?)
    }

    #[cfg(test)]
    fn get_max_amount_in(&self, _trade_direction: TradeDirection) -> Result<u64> {
        Ok(std::u64::MAX)
    }
}
fn get_initial_token_a(sqrt_price: u128, liquidity: u128) -> Result<u64> {
    let amount = liquidity.div_ceil(sqrt_price);
    return Ok(amount.safe_cast()?);
}

fn get_initial_token_b(sqrt_price: u128, liquidity: u128) -> Result<u64> {
    let liquidity = U256::from(liquidity);
    let sqrt_price = U256::from(sqrt_price);
    let numerator = liquidity.safe_mul(sqrt_price)?;
    let denominator = U256::from(1).safe_shl(128)?;
    let amount = numerator.div_ceil(denominator);
    return Ok(amount.try_into().map_err(|_| PoolError::TypeCastFailed)?);
}
