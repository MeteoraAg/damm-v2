#[cfg(test)]
use crate::params::swap::TradeDirection;
use crate::{
    // curve::{
    //     get_delta_amount_a_unsigned, get_delta_amount_a_unsigned_unchecked,
    //     get_delta_amount_b_unsigned, get_delta_amount_b_unsigned_unchecked,
    //     get_next_sqrt_price_from_input, get_next_sqrt_price_from_output,
    // },
    safe_math::SafeMath,
    state::{SwapAmountFromInput, SwapAmountFromOutput},
    u128x128_math::{mul_div_u256, Rounding},
    InitialPoolInformation,
    LiquidityHandler,
    PoolError,
};
use anchor_lang::prelude::*;
use ruint::aliases::U256;
pub struct ConcentratedLiquidity {
    pub sqrt_max_price: u128,
    pub sqrt_min_price: u128,
    pub sqrt_price: u128, // current sqrt price
    pub liquidity: u128,  // current liquidity
}

impl ConcentratedLiquidity {
    pub fn get_initial_pool_information(
        sqrt_min_price: u128,
        sqrt_max_price: u128,
        sqrt_price: u128,
        liquidity: u128,
    ) -> Result<InitialPoolInformation> {
        // BASE TOKEN
        let token_a_amount =
            get_delta_amount_a_unsigned(sqrt_price, sqrt_max_price, liquidity, Rounding::Up)?;
        // QUOTE TOKEN
        let token_b_amount =
            get_delta_amount_b_unsigned(sqrt_min_price, sqrt_price, liquidity, Rounding::Up)?;
        Ok(InitialPoolInformation {
            token_a_amount,
            token_b_amount,
            sqrt_price,
            initial_liquidity: liquidity,
            sqrt_max_price,
            sqrt_min_price,
        })
    }
}

impl LiquidityHandler for ConcentratedLiquidity {
    fn get_amounts_for_modify_liquidity(
        &self,
        liquidity_delta: u128,
        round: Rounding,
    ) -> Result<(u64, u64)> {
        // finding output amount
        let token_a_amount = get_delta_amount_a_unsigned(
            self.sqrt_price,
            self.sqrt_max_price,
            liquidity_delta,
            round,
        )?;

        let token_b_amount = get_delta_amount_b_unsigned(
            self.sqrt_min_price,
            self.sqrt_price,
            liquidity_delta,
            round,
        )?;

        Ok((token_a_amount, token_b_amount))
    }

    fn calculate_a_to_b_from_amount_in(&self, amount_in: u64) -> Result<SwapAmountFromInput> {
        // finding new target price
        let next_sqrt_price =
            get_next_sqrt_price_from_input(self.sqrt_price, self.liquidity, amount_in, true)?;

        if next_sqrt_price < self.sqrt_min_price {
            return Err(PoolError::PriceRangeViolation.into());
        }

        // finding output amount
        let output_amount = get_delta_amount_b_unsigned(
            next_sqrt_price,
            self.sqrt_price,
            self.liquidity,
            Rounding::Down,
        )?;

        Ok(SwapAmountFromInput {
            output_amount,
            next_sqrt_price,
            amount_left: 0,
        })
    }

    fn calculate_b_to_a_from_amount_in(&self, amount_in: u64) -> Result<SwapAmountFromInput> {
        // finding new target price
        let next_sqrt_price =
            get_next_sqrt_price_from_input(self.sqrt_price, self.liquidity, amount_in, false)?;

        if next_sqrt_price > self.sqrt_max_price {
            return Err(PoolError::PriceRangeViolation.into());
        }
        // finding output amount
        let output_amount = get_delta_amount_a_unsigned(
            self.sqrt_price,
            next_sqrt_price,
            self.liquidity,
            Rounding::Down,
        )?;

        Ok(SwapAmountFromInput {
            output_amount,
            next_sqrt_price,
            amount_left: 0,
        })
    }

    fn calculate_a_to_b_from_partial_amount_in(
        &self,
        amount_in: u64,
    ) -> Result<SwapAmountFromInput> {
        let max_amount_in = get_delta_amount_a_unsigned_unchecked(
            self.sqrt_min_price,
            self.sqrt_price,
            self.liquidity,
            Rounding::Up,
        )?;

        let (consumed_in_amount, next_sqrt_price) = if U256::from(amount_in) >= max_amount_in {
            (
                max_amount_in
                    .try_into()
                    .map_err(|_| PoolError::TypeCastFailed)?,
                self.sqrt_min_price,
            )
        } else {
            let next_sqrt_price =
                get_next_sqrt_price_from_input(self.sqrt_price, self.liquidity, amount_in, true)?;
            (amount_in, next_sqrt_price)
        };

        let output_amount = get_delta_amount_b_unsigned(
            next_sqrt_price,
            self.sqrt_price,
            self.liquidity,
            Rounding::Down,
        )?;

        let amount_left = amount_in.safe_sub(consumed_in_amount)?;

        Ok(SwapAmountFromInput {
            output_amount,
            next_sqrt_price,
            amount_left,
        })
    }

    fn calculate_b_to_a_from_partial_amount_in(
        &self,
        amount_in: u64,
    ) -> Result<SwapAmountFromInput> {
        let max_amount_in = get_delta_amount_b_unsigned_unchecked(
            self.sqrt_price,
            self.sqrt_max_price,
            self.liquidity,
            Rounding::Up,
        )?;

        let (consumed_in_amount, next_sqrt_price) = if U256::from(amount_in) >= max_amount_in {
            (
                max_amount_in
                    .try_into()
                    .map_err(|_| PoolError::TypeCastFailed)?,
                self.sqrt_max_price,
            )
        } else {
            let next_sqrt_price =
                get_next_sqrt_price_from_input(self.sqrt_price, self.liquidity, amount_in, false)?;
            (amount_in, next_sqrt_price)
        };

        let output_amount = get_delta_amount_a_unsigned(
            self.sqrt_price,
            next_sqrt_price,
            self.liquidity,
            Rounding::Down,
        )?;

        let amount_left = amount_in.safe_sub(consumed_in_amount)?;

        Ok(SwapAmountFromInput {
            output_amount,
            next_sqrt_price,
            amount_left,
        })
    }

    fn calculate_a_to_b_from_amount_out(&self, amount_out: u64) -> Result<SwapAmountFromOutput> {
        let next_sqrt_price =
            get_next_sqrt_price_from_output(self.sqrt_price, self.liquidity, amount_out, true)?;

        if next_sqrt_price < self.sqrt_min_price {
            return Err(PoolError::PriceRangeViolation.into());
        }

        let in_amount = get_delta_amount_a_unsigned(
            next_sqrt_price,
            self.sqrt_price,
            self.liquidity,
            Rounding::Up,
        )?;

        Ok(SwapAmountFromOutput {
            input_amount: in_amount,
            next_sqrt_price,
        })
    }

    fn calculate_b_to_a_from_amount_out(&self, amount_out: u64) -> Result<SwapAmountFromOutput> {
        let next_sqrt_price =
            get_next_sqrt_price_from_output(self.sqrt_price, self.liquidity, amount_out, false)?;

        if next_sqrt_price > self.sqrt_max_price {
            return Err(PoolError::PriceRangeViolation.into());
        }

        let in_amount = get_delta_amount_b_unsigned(
            self.sqrt_price,
            next_sqrt_price,
            self.liquidity,
            Rounding::Up,
        )?;

        Ok(SwapAmountFromOutput {
            input_amount: in_amount,
            next_sqrt_price,
        })
    }

    fn get_reserves_amount(&self) -> Result<(u64, u64)> {
        let reserve_a_amount = get_delta_amount_a_unsigned(
            self.sqrt_price,
            self.sqrt_max_price,
            self.liquidity,
            Rounding::Up,
        )?;

        let reserve_b_amount = get_delta_amount_b_unsigned(
            self.sqrt_min_price,
            self.sqrt_price,
            self.liquidity,
            Rounding::Up,
        )?;

        Ok((reserve_a_amount, reserve_b_amount))
    }

    fn get_next_sqrt_price(&self, next_sqrt_price: u128) -> Result<u128> {
        Ok(next_sqrt_price)
    }

    #[cfg(test)]
    fn get_max_amount_in(&self, trade_direction: TradeDirection) -> Result<u64> {
        let amount = match trade_direction {
            TradeDirection::AtoB => get_delta_amount_a_unsigned_unchecked(
                self.sqrt_min_price,
                self.sqrt_price,
                self.liquidity,
                Rounding::Down,
            )?,
            TradeDirection::BtoA => get_delta_amount_b_unsigned_unchecked(
                self.sqrt_price,
                self.sqrt_max_price,
                self.liquidity,
                Rounding::Down,
            )?,
        };
        if amount > U256::from(u64::MAX) {
            Ok(u64::MAX)
        } else {
            Ok(amount.try_into().unwrap())
        }
    }
}

/// Gets the delta amount_a for given liquidity and price range
///
/// # Formula
///
/// * `Δa = L * (1 / √P_lower - 1 / √P_upper)`
/// * i.e. `L * (√P_upper - √P_lower) / (√P_upper * √P_lower)`
pub fn get_delta_amount_a_unsigned(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<u64> {
    let result = get_delta_amount_a_unsigned_unchecked(
        lower_sqrt_price,
        upper_sqrt_price,
        liquidity,
        round,
    )?;
    require!(result <= U256::from(u64::MAX), PoolError::MathOverflow);
    Ok(result.try_into().map_err(|_| PoolError::TypeCastFailed)?)
}

/// * i.e. `L * (√P_upper - √P_lower) / (√P_upper * √P_lower)`
pub fn get_delta_amount_a_unsigned_unchecked(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<U256> {
    let numerator_1 = U256::from(liquidity);
    let numerator_2 = U256::from(upper_sqrt_price - lower_sqrt_price);

    let denominator = U256::from(lower_sqrt_price).safe_mul(U256::from(upper_sqrt_price))?;

    assert!(denominator > U256::ZERO);
    let result = mul_div_u256(numerator_1, numerator_2, denominator, round)
        .ok_or_else(|| PoolError::MathOverflow)?;
    Ok(result)
}

/// Gets the delta amount_b for given liquidity and price range
/// Δb = L * (√P_upper - √P_lower)
pub fn get_delta_amount_b_unsigned(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<u64> {
    let result = get_delta_amount_b_unsigned_unchecked(
        lower_sqrt_price,
        upper_sqrt_price,
        liquidity,
        round,
    )?;
    require!(result <= U256::from(u64::MAX), PoolError::MathOverflow);
    Ok(result.try_into().map_err(|_| PoolError::TypeCastFailed)?)
}

// Δb = L * (√P_upper - √P_lower)
pub fn get_delta_amount_b_unsigned_unchecked(
    lower_sqrt_price: u128,
    upper_sqrt_price: u128,
    liquidity: u128,
    round: Rounding,
) -> Result<U256> {
    let liquidity = U256::from(liquidity);
    let delta_sqrt_price = U256::from(upper_sqrt_price.safe_sub(lower_sqrt_price)?);
    let prod = liquidity.safe_mul(delta_sqrt_price)?;

    match round {
        Rounding::Up => {
            let denominator = U256::from(1).safe_shl(128)?;
            let result = prod.div_ceil(denominator);
            Ok(result)
        }
        Rounding::Down => {
            let (result, _) = prod.overflowing_shr(128);
            Ok(result)
        }
    }
}

/// Gets the next sqrt price given an input amount of token_a or token_b
/// Throws if price or liquidity are 0, or if the next price is out of bounds
pub fn get_next_sqrt_price_from_input(
    sqrt_price: u128,
    liquidity: u128,
    amount_in: u64,
    a_for_b: bool,
) -> Result<u128> {
    assert!(sqrt_price > 0);
    assert!(liquidity > 0);

    // round to make sure that we don't pass the target price
    if a_for_b {
        get_next_sqrt_price_from_amount_in_a_rounding_up(sqrt_price, liquidity, amount_in)
    } else {
        get_next_sqrt_price_from_amount_in_b_rounding_down(sqrt_price, liquidity, amount_in)
    }
}

/// Gets the next sqrt price given an output amount of token_a or token_b
/// Throws if price or liquidity are 0, or if the next price is out of bounds
pub fn get_next_sqrt_price_from_output(
    sqrt_price: u128,
    liquidity: u128,
    amount_out: u64,
    a_for_b: bool,
) -> Result<u128> {
    assert!(sqrt_price > 0);
    assert!(liquidity > 0);

    // round to make sure that we don't pass the target price
    if a_for_b {
        get_next_sqrt_price_from_amount_out_b_rounding_down(sqrt_price, liquidity, amount_out)
    } else {
        get_next_sqrt_price_from_amount_out_a_rounding_up(sqrt_price, liquidity, amount_out)
    }
}

/// Gets the next sqrt price √P' given a delta of token_a
///
/// Always round up because
/// 1. In the exact output case, token_a supply decreases leading to price increase.
/// Move price up so that exact output is met.
/// 2. In the exact input case, token_a supply increases leading to price decrease.
/// Do not round down to minimize price impact. We only need to meet input
/// change and not guarantee exact output.
///
/// Use function for exact input or exact output swaps for token_a
///
/// # Formula
///
/// * `√P' = √P * L / (L + Δa * √P)`
/// * If Δa * √P overflows, use alternate form `√P' = L / (L/√P + Δa)`
///
/// # Proof
///
/// For constant L,
///
///  L = a * √P
///  a' = a + Δa
///  a' * √P' = a * √P
///  (a + Δa) * √P' = a * √P
///  √P' = (a * √P) / (a + Δa)
///  a = L/√P
///  √P' = √P * L / (L + Δa * √P)
///
pub fn get_next_sqrt_price_from_amount_in_a_rounding_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    if amount == 0 {
        return Ok(sqrt_price);
    }
    let sqrt_price = U256::from(sqrt_price);
    let liquidity = U256::from(liquidity);

    let product = U256::from(amount).safe_mul(sqrt_price)?;
    let denominator = liquidity.safe_add(U256::from(product))?;
    let result = mul_div_u256(liquidity, sqrt_price, denominator, Rounding::Up)
        .ok_or_else(|| PoolError::MathOverflow)?;
    Ok(result.try_into().map_err(|_| PoolError::TypeCastFailed)?)
}

///  √P' = √P * L / (L - Δa * √P)
pub fn get_next_sqrt_price_from_amount_out_a_rounding_up(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    if amount == 0 {
        return Ok(sqrt_price);
    }
    let sqrt_price = U256::from(sqrt_price);
    let liquidity = U256::from(liquidity);

    let product = U256::from(amount).safe_mul(sqrt_price)?;
    let denominator = liquidity.safe_sub(U256::from(product))?;
    let result = mul_div_u256(liquidity, sqrt_price, denominator, Rounding::Up)
        .ok_or_else(|| PoolError::MathOverflow)?;
    Ok(result.try_into().map_err(|_| PoolError::TypeCastFailed)?)
}

/// Gets the next sqrt price given a delta of token_b
///
/// Always round down because
/// 1. In the exact output case, token_b supply decreases leading to price decrease.
/// Move price down by rounding down so that exact output of token_a is met.
/// 2. In the exact input case, token_b supply increases leading to price increase.
/// Do not round down to minimize price impact. We only need to meet input
/// change and not guarantee exact output for token_a.
///
///
/// # Formula
///
/// * `√P' = √P + Δb / L`
///
pub fn get_next_sqrt_price_from_amount_in_b_rounding_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    let quotient = U256::from(amount)
        .safe_shl(128)?
        .safe_div(U256::from(liquidity))?;

    let result = U256::from(sqrt_price).safe_add(quotient)?;
    Ok(result.try_into().map_err(|_| PoolError::TypeCastFailed)?)
}

/// `√P' = √P - Δb / L`
pub fn get_next_sqrt_price_from_amount_out_b_rounding_down(
    sqrt_price: u128,
    liquidity: u128,
    amount: u64,
) -> Result<u128> {
    let quotient = U256::from(amount)
        .safe_shl(128)?
        .div_ceil(U256::from(liquidity));

    let result = U256::from(sqrt_price).safe_sub(quotient)?;
    Ok(result.try_into().map_err(|_| PoolError::TypeCastFailed)?)
}
