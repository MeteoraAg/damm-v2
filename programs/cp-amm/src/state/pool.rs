use crate::constants::LIQUIDITY_MAX;
use crate::curve::get_delta_amount_a_unsigned_unchecked;
use crate::params::swap::TradeDirection;
use crate::u128x128_math::mul_div;
use crate::{
    curve::{
        get_delta_amount_a_unsigned, get_delta_amount_b_unsigned, get_next_sqrt_price_from_input,
    },
    safe_math::SafeMath,
    u128x128_math::Rounding,
    PoolError,
};
use ruint::aliases::U256;
use std::u64;

use super::fee::{DynamicFeeStruct, FeeOnAmountResult, PoolFeesStruct};
use super::Position;
use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
/// collect fee mode
#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum CollectFeeMode {
    /// Both token, in this mode only out token is collected
    BothToken,
    /// Only token B, we just need token B, because if user want to collect fee in token A, they just need to flip order of tokens
    OnlyB,
}

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum PoolType {
    Permissionless,
    Customizable,
}

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct Pool {
    /// Pool fee
    pub pool_fees: PoolFeesStruct,
    /// token a mint
    pub token_a_mint: Pubkey,
    /// token b mint
    pub token_b_mint: Pubkey,
    /// token a vault
    pub token_a_vault: Pubkey,
    /// token b vault
    pub token_b_vault: Pubkey,
    /// Whitelisted vault to be able to buy pool before activation_point
    pub whitelisted_vault: Pubkey,
    /// pool creator
    pub pool_creator: Pubkey,
    /// liquidity share
    pub liquidity: u128,
    /// token a reserve
    pub token_a_reserve: u64,
    /// token b reserve
    pub token_b_reserve: u64,
    /// protocol a fee
    pub protocol_a_fee: u64,
    /// protocol b fee
    pub protocol_b_fee: u64,
    /// partner a fee
    pub partner_a_fee: u64,
    /// partner b fee
    pub partner_b_fee: u64,
    /// min price
    pub sqrt_min_price: u128,
    /// max price
    pub sqrt_max_price: u128,
    /// current price
    pub sqrt_price: u128,
    /// Activation point, can be slot or timestamp
    pub activation_point: u64,
    /// Activation type, 0 means by slot, 1 means by timestamp
    pub activation_type: u8,
    /// pool status
    pub pool_status: u8,
    /// token a flag
    pub token_a_flag: u8,
    /// token b flag
    pub token_b_flag: u8,
    /// 0 is collect fee in both token, 1 only collect fee in token a, 2 only collect fee in token b
    pub collect_fee_mode: u8,
    /// pool type
    pub pool_type: u8,
    /// padding
    pub _padding_0: [u8; 2],
    /// cummulative
    pub fee_a_per_liquidity: u128,
    /// cummulative
    pub fee_b_per_liquidity: u128,
    /// Padding for further use
    pub _padding_1: [u64; 10],
}

impl Pool {
    pub fn initialize(
        &mut self,
        pool_fees: PoolFeesStruct,
        token_a_mint: Pubkey,
        token_b_mint: Pubkey,
        token_a_vault: Pubkey,
        token_b_vault: Pubkey,
        whitelisted_vault: Pubkey,
        pool_creator: Pubkey,
        sqrt_min_price: u128,
        sqrt_max_price: u128,
        sqrt_price: u128,
        activation_point: u64,
        activation_type: u8,
        token_a_flag: u8,
        token_b_flag: u8,
        token_a_reserve: u64,
        token_b_reserve: u64,
        liquidity: u128,
        collect_fee_mode: u8,
        pool_type: u8,
    ) {
        self.pool_fees = pool_fees;
        self.token_a_mint = token_a_mint;
        self.token_b_mint = token_b_mint;
        self.token_a_vault = token_a_vault;
        self.token_b_vault = token_b_vault;
        self.whitelisted_vault = whitelisted_vault;
        self.pool_creator = pool_creator;
        self.sqrt_min_price = sqrt_min_price;
        self.sqrt_max_price = sqrt_max_price;
        self.activation_point = activation_point;
        self.activation_type = activation_type;
        self.token_a_flag = token_a_flag;
        self.token_b_flag = token_b_flag;
        self.token_a_reserve = token_a_reserve;
        self.token_b_reserve = token_b_reserve;
        self.liquidity = liquidity;
        self.sqrt_price = sqrt_price;
        self.collect_fee_mode = collect_fee_mode;
        self.pool_type = pool_type;
    }

    pub fn get_swap_result(
        &self,
        amount_in: u64,
        is_referral: bool,
        trade_direction: TradeDirection,
    ) -> Result<SwapResult> {
        let collect_fee_mode = CollectFeeMode::try_from(self.collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        match collect_fee_mode {
            CollectFeeMode::BothToken => match trade_direction {
                TradeDirection::AtoB => self.get_swap_result_from_a_to_b(amount_in, is_referral),
                TradeDirection::BtoA => {
                    self.get_swap_result_from_b_to_a(amount_in, is_referral, false)
                }
            },
            CollectFeeMode::OnlyB => match trade_direction {
                TradeDirection::AtoB => self.get_swap_result_from_a_to_b(amount_in, is_referral), // this is fine since we still collect fee in token out
                TradeDirection::BtoA => {
                    // fee will be in token b
                    let FeeOnAmountResult {
                        amount,
                        lp_fee,
                        protocol_fee,
                        partner_fee,
                        referral_fee,
                    } = self.pool_fees.get_fee_on_amount(amount_in, is_referral)?;
                    // skip fee
                    let swap_result =
                        self.get_swap_result_from_b_to_a(amount, is_referral, true)?;

                    Ok(SwapResult {
                        output_amount: swap_result.output_amount,
                        next_sqrt_price: swap_result.next_sqrt_price,
                        lp_fee,
                        protocol_fee,
                        partner_fee,
                        referral_fee,
                    })
                }
            },
        }
    }
    fn get_swap_result_from_a_to_b(&self, amount_in: u64, is_referral: bool) -> Result<SwapResult> {
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

        let FeeOnAmountResult {
            amount,
            lp_fee,
            protocol_fee,
            partner_fee,
            referral_fee,
        } = self
            .pool_fees
            .get_fee_on_amount(output_amount, is_referral)?;
        Ok(SwapResult {
            output_amount: amount,
            lp_fee,
            protocol_fee,
            partner_fee,
            referral_fee,
            next_sqrt_price,
        })
    }

    fn get_swap_result_from_b_to_a(
        &self,
        amount_in: u64,
        is_referral: bool,
        is_skip_fee: bool,
    ) -> Result<SwapResult> {
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

        if is_skip_fee {
            Ok(SwapResult {
                output_amount,
                lp_fee: 0,
                protocol_fee: 0,
                partner_fee: 0,
                referral_fee: 0,
                next_sqrt_price,
            })
        } else {
            let FeeOnAmountResult {
                amount,
                lp_fee,
                protocol_fee,
                partner_fee,
                referral_fee,
            } = self
                .pool_fees
                .get_fee_on_amount(output_amount, is_referral)?;
            Ok(SwapResult {
                output_amount: amount,
                lp_fee,
                protocol_fee,
                partner_fee,
                referral_fee,
                next_sqrt_price,
            })
        }
    }

    pub fn apply_swap_result(
        &mut self,
        swap_result: &SwapResult,
        trade_direction: TradeDirection,
        current_timestamp: u64,
    ) -> Result<()> {
        let &SwapResult {
            output_amount: _output_amount,
            lp_fee,
            next_sqrt_price,
            protocol_fee,
            partner_fee,
            referral_fee: _referral_fee,
        } = swap_result;
        let old_sqrt_price = self.sqrt_price;
        self.sqrt_price = next_sqrt_price;
        let fee_per_token_stored: u128 =
            mul_div(lp_fee.into(), LIQUIDITY_MAX, self.liquidity, Rounding::Down).unwrap();

        let collect_fee_mode = CollectFeeMode::try_from(self.collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        if collect_fee_mode == CollectFeeMode::OnlyB || trade_direction == TradeDirection::AtoB {
            self.partner_b_fee = self.partner_b_fee.safe_add(partner_fee)?;
            self.protocol_b_fee = self.partner_b_fee.safe_add(protocol_fee)?;
            self.fee_b_per_liquidity = self.fee_b_per_liquidity.safe_add(fee_per_token_stored)?;
        } else {
            self.partner_a_fee = self.partner_a_fee.safe_add(partner_fee)?;
            self.protocol_a_fee = self.partner_a_fee.safe_add(protocol_fee)?;
            self.fee_a_per_liquidity = self.fee_a_per_liquidity.safe_add(fee_per_token_stored)?;
        }
        self.update_post_swap(old_sqrt_price, current_timestamp)?;
        Ok(())
    }

    pub fn get_amounts_for_modify_liquidity(
        &self,
        liquidity_delta: u128,
        round: Rounding,
    ) -> Result<ModifyLiquidityResult> {
        // finding output amount
        let amount_a = get_delta_amount_a_unsigned(
            self.sqrt_price,
            self.sqrt_max_price,
            liquidity_delta,
            round,
        )?;

        let amount_b = get_delta_amount_b_unsigned(
            self.sqrt_min_price,
            self.sqrt_price,
            liquidity_delta,
            round,
        )?;

        Ok(ModifyLiquidityResult { amount_a, amount_b })
    }

    pub fn apply_add_liquidity(
        &mut self,
        position: &mut Position,
        liquidity_delta: u128,
    ) -> Result<()> {
        // update current fee for position
        position.update_fee(self.fee_a_per_liquidity, self.fee_b_per_liquidity)?;

        // add liquidity
        position.add_liquidity(liquidity_delta)?;

        self.liquidity = self.liquidity.safe_add(liquidity_delta)?;

        Ok(())
    }

    pub fn apply_remove_liquidity(
        &mut self,
        position: &mut Position,
        liquidity_delta: u128,
    ) -> Result<()> {
        // update current fee for position
        position.update_fee(self.fee_a_per_liquidity, self.fee_b_per_liquidity)?;

        // remove liquidity
        position.remove_liquidity(liquidity_delta)?;

        self.liquidity = self.liquidity.safe_sub(liquidity_delta)?;

        Ok(())
    }

    pub fn get_max_amount_in(&self, trade_direction: TradeDirection) -> Result<u64> {
        let amount = match trade_direction {
            TradeDirection::AtoB => get_delta_amount_a_unsigned_unchecked(
                self.sqrt_min_price,
                self.sqrt_price,
                self.liquidity,
                Rounding::Down,
            )?,
            TradeDirection::BtoA => get_delta_amount_a_unsigned_unchecked(
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

    pub fn update_pre_swap(&mut self, current_timestamp: u64) -> Result<()> {
        if self.pool_fees.dynamic_fee.is_dynamic_fee_enable() {
            self.pool_fees
                .dynamic_fee
                .update_references(self.sqrt_price, current_timestamp)?;
        }
        Ok(())
    }

    pub fn update_post_swap(&mut self, old_sqrt_price: u128, current_timestamp: u64) -> Result<()> {
        if self.pool_fees.dynamic_fee.is_dynamic_fee_enable() {
            self.pool_fees
                .dynamic_fee
                .update_volatility_accumulator(self.sqrt_price)?;

            // update only last_update_timestamp if bin is crossed
            let delta_price = DynamicFeeStruct::get_detal_bin_id(
                self.pool_fees.dynamic_fee.bin_step_u128,
                old_sqrt_price,
                self.sqrt_price,
            )?;
            if delta_price > 0 {
                self.pool_fees.dynamic_fee.last_update_timestamp = current_timestamp;
            }
        }
        Ok(())
    }
}

/// Encodes all results of swapping
#[derive(Debug, PartialEq, AnchorDeserialize, AnchorSerialize)]
pub struct SwapResult {
    pub output_amount: u64,
    pub next_sqrt_price: u128,
    pub lp_fee: u64,
    pub protocol_fee: u64,
    pub partner_fee: u64,
    pub referral_fee: u64,
}

#[derive(Debug, PartialEq)]
pub struct ModifyLiquidityResult {
    pub amount_a: u64,
    pub amount_b: u64,
}
