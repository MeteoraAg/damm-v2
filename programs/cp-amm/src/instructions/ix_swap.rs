use crate::{
    activation_handler::ActivationHandler,
    const_pda, get_pool_access_validator,
    instruction::Swap as SwapInstruction,
    params::swap::TradeDirection,
    safe_math::SafeMath,
    state::{fee::FeeMode, Pool, SwapResult, SwapResult2},
    token::{
        calculate_transfer_fee_excluded_amount, calculate_transfer_fee_included_amount,
        transfer_from_pool, transfer_from_user,
    },
    EvtSwap, EvtSwap2, PoolError,
};
use anchor_lang::solana_program::sysvar;
use anchor_lang::{
    prelude::*,
    solana_program::instruction::{get_processed_sibling_instruction, get_stack_height},
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num_enum::{FromPrimitive, IntoPrimitive};

#[repr(u8)]
#[derive(
    Clone, Copy, Debug, PartialEq, IntoPrimitive, FromPrimitive, AnchorDeserialize, AnchorSerialize,
)]
pub enum SwapMode {
    #[num_enum(default)]
    ExactIn,
    ExactOut,
    PartialFillIn,
    PartialFillOut,
}

impl SwapMode {
    pub fn is_swap_in(&self) -> bool {
        matches!(self, SwapMode::ExactIn | SwapMode::PartialFillIn)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapParameters {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapParameters2 {
    pub amount_0: u64,
    pub amount_1: u64,
    pub swap_mode: u8,
}

impl SwapParameters2 {
    pub fn validate(&self) -> Result<()> {
        SwapMode::try_from(self.swap_mode).map_err(|_| PoolError::InvalidInput)?;
        require!(self.amount_0 > 0, PoolError::InvalidInput);
        Ok(())
    }
}

struct SwapAccounts<'a, 'info> {
    token_in_mint: &'a Box<InterfaceAccount<'info, Mint>>,
    token_out_mint: &'a Box<InterfaceAccount<'info, Mint>>,
    input_vault_account: &'a Box<InterfaceAccount<'info, TokenAccount>>,
    output_vault_account: &'a Box<InterfaceAccount<'info, TokenAccount>>,
    input_program: &'a Interface<'info, TokenInterface>,
    output_program: &'a Interface<'info, TokenInterface>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SwapCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Pool account
    #[account(mut, has_one = token_a_vault, has_one = token_b_vault)]
    pub pool: AccountLoader<'info, Pool>,

    /// The user token account for input token
    #[account(mut)]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The user token account for output token
    #[account(mut)]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for input token
    #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token a
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of token b
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The user performing the swap
    pub payer: Signer<'info>,

    /// Token a program
    pub token_a_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_b_program: Interface<'info, TokenInterface>,

    /// referral token account
    #[account(mut)]
    pub referral_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

impl<'info> SwapCtx<'info> {
    /// Get the trading direction of the current swap. Eg: USDT -> USDC
    pub fn get_trade_direction(&self) -> TradeDirection {
        if self.input_token_account.mint == self.token_a_mint.key() {
            return TradeDirection::AtoB;
        }
        TradeDirection::BtoA
    }

    fn get_swap_accounts<'a>(&'a self) -> SwapAccounts<'a, 'info> {
        let trade_direction = self.get_trade_direction();

        let (
            token_in_mint,
            token_out_mint,
            input_vault_account,
            output_vault_account,
            input_program,
            output_program,
        ) = match trade_direction {
            TradeDirection::AtoB => (
                &self.token_a_mint,
                &self.token_b_mint,
                &self.token_a_vault,
                &self.token_b_vault,
                &self.token_a_program,
                &self.token_b_program,
            ),
            TradeDirection::BtoA => (
                &self.token_b_mint,
                &self.token_a_mint,
                &self.token_b_vault,
                &self.token_a_vault,
                &self.token_b_program,
                &self.token_a_program,
            ),
        };

        SwapAccounts {
            token_in_mint,
            token_out_mint,
            input_vault_account,
            output_vault_account,
            input_program,
            output_program,
        }
    }
}

pub fn handle_swap_v1(ctx: Context<SwapCtx>, params: SwapParameters) -> Result<()> {
    let (swap_evt_v1, _swap_evt_v2) = compute_swap_result(
        &ctx,
        SwapParameters2 {
            amount_0: params.amount_in,
            amount_1: params.minimum_amount_out,
            swap_mode: SwapMode::ExactIn.into(),
        },
    )?;

    emit_cpi!(swap_evt_v1);
    Ok(())
}

pub fn handle_swap_v2(ctx: Context<SwapCtx>, params: SwapParameters2) -> Result<()> {
    let (swap_evt_v1, swap_evt_v2) = compute_swap_result(&ctx, params)?;

    emit_cpi!(swap_evt_v1);
    emit_cpi!(swap_evt_v2);
    Ok(())
}

pub fn compute_swap_result(
    ctx: &Context<SwapCtx>,
    params: SwapParameters2,
) -> Result<(EvtSwap, EvtSwap2)> {
    params.validate()?;

    let swap_mode = SwapMode::from(params.swap_mode);
    let is_swap_in = swap_mode.is_swap_in();
    let has_referral = ctx.accounts.referral_token_account.is_some();

    let SwapAccounts {
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    } = ctx.accounts.get_swap_accounts();

    let (swap_result, fee_mode, swap_evt_v1, swap_evt_v2) = if is_swap_in {
        compute_swap_in_result(
            ctx,
            token_in_mint,
            token_out_mint,
            params.amount_0,
            params.amount_1,
            swap_mode,
        )
    } else {
        compute_swap_out_result(
            ctx,
            token_in_mint,
            token_out_mint,
            params.amount_0,
            params.amount_1,
            swap_mode,
        )
    }?;

    let SwapResult2 {
        included_fee_input_amount: amount_in,
        excluded_fee_output_amount: amount_out,
        referral_fee,
        ..
    } = swap_result;

    // send to reserve
    transfer_from_user(
        &ctx.accounts.payer,
        token_in_mint,
        &ctx.accounts.input_token_account,
        input_vault_account,
        input_program,
        amount_in,
    )?;

    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        token_out_mint,
        output_vault_account,
        &ctx.accounts.output_token_account,
        output_program,
        amount_out,
    )?;

    // send to referral
    if has_referral {
        if fee_mode.fees_on_token_a {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.token_a_mint,
                &ctx.accounts.token_a_vault,
                &ctx.accounts.referral_token_account.clone().unwrap(),
                &ctx.accounts.token_a_program,
                referral_fee,
            )?;
        } else {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.token_b_mint,
                &ctx.accounts.token_b_vault,
                &ctx.accounts.referral_token_account.clone().unwrap(),
                &ctx.accounts.token_b_program,
                referral_fee,
            )?;
        }
    }

    Ok((swap_evt_v1, swap_evt_v2))
}

fn compute_swap_out_result<'info>(
    ctx: &Context<SwapCtx>,
    token_in_mint: &Box<InterfaceAccount<'info, Mint>>,
    token_out_mint: &Box<InterfaceAccount<'info, Mint>>,
    amount_out: u64,
    maximum_amount_in: u64,
    swap_mode: SwapMode,
) -> Result<(SwapResult2, FeeMode, EvtSwap, EvtSwap2)> {
    let transfer_fee_included_amount_out =
        calculate_transfer_fee_included_amount(token_out_mint, amount_out)?.amount;

    let (swap_result, fee_mode) =
        inner_handle_swap(ctx, transfer_fee_included_amount_out, swap_mode)?;

    let transfer_fee_included_amount_in = calculate_transfer_fee_included_amount(
        token_in_mint,
        swap_result.included_fee_input_amount,
    )?
    .amount;

    require!(
        transfer_fee_included_amount_in <= maximum_amount_in,
        PoolError::ExceededSlippage
    );

    let current_timestamp = Clock::get()?.unix_timestamp as u64;

    // For indexer backward compatibility
    let swap_result_v1 = SwapResult {
        output_amount: swap_result.excluded_fee_output_amount,
        next_sqrt_price: swap_result.next_sqrt_price,
        lp_fee: swap_result.lp_fee,
        protocol_fee: swap_result.protocol_fee,
        partner_fee: swap_result.partner_fee,
        referral_fee: swap_result.referral_fee,
    };

    let swap_event_v1 = EvtSwap {
        pool: ctx.accounts.pool.key(),
        trade_direction: ctx.accounts.get_trade_direction().into(),
        has_referral: ctx.accounts.referral_token_account.is_some(),
        params: SwapParameters {
            amount_in: transfer_fee_included_amount_in,
            minimum_amount_out: amount_out,
        },
        swap_result: swap_result_v1,
        actual_amount_in: swap_result.included_fee_input_amount,
        current_timestamp,
    };

    let swap_event_v2 = EvtSwap2 {
        pool: ctx.accounts.pool.key(),
        trade_direction: ctx.accounts.get_trade_direction().into(),
        has_referral: ctx.accounts.referral_token_account.is_some(),
        params: SwapParameters2 {
            amount_0: amount_out,
            amount_1: maximum_amount_in,
            swap_mode: swap_mode.into(),
        },
        swap_result,
        actual_amount_in: swap_result.included_fee_input_amount,
        current_timestamp,
    };

    Ok((swap_result, fee_mode, swap_event_v1, swap_event_v2))
}

fn compute_swap_in_result<'info>(
    ctx: &Context<SwapCtx>,
    token_in_mint: &Box<InterfaceAccount<'info, Mint>>,
    token_out_mint: &Box<InterfaceAccount<'info, Mint>>,
    amount_in: u64,
    minimum_amount_out: u64,
    swap_mode: SwapMode,
) -> Result<(SwapResult2, FeeMode, EvtSwap, EvtSwap2)> {
    let transfer_fee_excluded_amount_in =
        calculate_transfer_fee_excluded_amount(token_in_mint, amount_in)?.amount;
    require!(transfer_fee_excluded_amount_in > 0, PoolError::AmountIsZero);

    let (swap_result, fee_mode) =
        inner_handle_swap(&ctx, transfer_fee_excluded_amount_in, swap_mode)?;

    let transfer_fee_excluded_amount_out = calculate_transfer_fee_excluded_amount(
        token_out_mint,
        swap_result.excluded_fee_output_amount,
    )?
    .amount;

    require!(
        transfer_fee_excluded_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    let current_timestamp = Clock::get()?.unix_timestamp as u64;

    // For indexer backward compatibility
    let swap_result_v1 = SwapResult {
        output_amount: swap_result.excluded_fee_output_amount,
        next_sqrt_price: swap_result.next_sqrt_price,
        lp_fee: swap_result.lp_fee,
        protocol_fee: swap_result.protocol_fee,
        partner_fee: swap_result.partner_fee,
        referral_fee: swap_result.referral_fee,
    };

    let swap_event_v1 = EvtSwap {
        pool: ctx.accounts.pool.key(),
        trade_direction: ctx.accounts.get_trade_direction().into(),
        has_referral: ctx.accounts.referral_token_account.is_some(),
        params: SwapParameters {
            amount_in,
            minimum_amount_out,
        },
        swap_result: swap_result_v1,
        actual_amount_in: transfer_fee_excluded_amount_in,
        current_timestamp,
    };

    let swap_event_v2 = EvtSwap2 {
        pool: ctx.accounts.pool.key(),
        trade_direction: ctx.accounts.get_trade_direction().into(),
        has_referral: ctx.accounts.referral_token_account.is_some(),
        params: SwapParameters2 {
            amount_0: amount_in,
            amount_1: minimum_amount_out,
            swap_mode: swap_mode.into(),
        },
        swap_result,
        actual_amount_in: transfer_fee_excluded_amount_in,
        current_timestamp,
    };

    Ok((swap_result, fee_mode, swap_event_v1, swap_event_v2))
}

fn inner_handle_swap(
    ctx: &Context<SwapCtx>,
    amount: u64,
    swap_mode: SwapMode,
) -> Result<(SwapResult2, FeeMode)> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&ctx.accounts.payer.key()),
            PoolError::PoolDisabled
        );
    }

    let trade_direction = ctx.accounts.get_trade_direction();
    let has_referral = ctx.accounts.referral_token_account.is_some();

    let mut pool = ctx.accounts.pool.load_mut()?;
    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    // another validation to prevent snipers to craft multiple swap instructions in 1 tx
    // (if we dont do this, they are able to concat 16 swap instructions in 1 tx)
    if let Ok(rate_limiter) = pool.pool_fees.base_fee.get_fee_rate_limiter() {
        if rate_limiter.is_rate_limiter_applied(
            current_point,
            pool.activation_point,
            trade_direction,
        )? {
            validate_single_swap_instruction(&ctx.accounts.pool.key(), ctx.remaining_accounts)?;
        }
    }

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(current_timestamp)?;

    let fee_mode = FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = match swap_mode {
        SwapMode::ExactIn => {
            pool.get_swap_exact_in_result(amount, &fee_mode, trade_direction, current_point)
        }
        SwapMode::ExactOut => {
            pool.get_swap_exact_out_result(amount, &fee_mode, trade_direction, current_point)
        }
        SwapMode::PartialFillIn => {
            pool.get_swap_partial_fill_in_result(amount, &fee_mode, trade_direction, current_point)
        }
        SwapMode::PartialFillOut => {
            pool.get_swap_partial_fill_out_result(amount, &fee_mode, trade_direction, current_point)
        }
    }?;

    pool.apply_swap_result(&swap_result, &fee_mode, current_timestamp)?;

    Ok((swap_result, fee_mode))
}

pub fn validate_single_swap_instruction<'c, 'info>(
    pool: &Pubkey,
    remaining_accounts: &'c [AccountInfo<'info>],
) -> Result<()> {
    let instruction_sysvar_account_info = remaining_accounts
        .get(0)
        .ok_or_else(|| PoolError::FailToValidateSingleSwapInstruction)?;

    // get current index of instruction
    let current_index =
        sysvar::instructions::load_current_index_checked(instruction_sysvar_account_info)?;
    let current_instruction = sysvar::instructions::load_instruction_at_checked(
        current_index.into(),
        instruction_sysvar_account_info,
    )?;

    if current_instruction.program_id != crate::ID {
        // check if current instruction is CPI
        // disable any stack height greater than 2
        if get_stack_height() > 2 {
            return Err(PoolError::FailToValidateSingleSwapInstruction.into());
        }
        // check for any sibling instruction
        let mut sibling_index = 0;
        while let Some(sibling_instruction) = get_processed_sibling_instruction(sibling_index) {
            if sibling_instruction.program_id == crate::ID
                && sibling_instruction.data[..8].eq(SwapInstruction::DISCRIMINATOR)
            {
                if sibling_instruction.accounts[1].pubkey.eq(pool) {
                    return Err(PoolError::FailToValidateSingleSwapInstruction.into());
                }
            }
            sibling_index = sibling_index.safe_add(1)?;
        }
    }

    if current_index == 0 {
        // skip for first instruction
        return Ok(());
    }
    for i in 0..current_index {
        let instruction = sysvar::instructions::load_instruction_at_checked(
            i.into(),
            instruction_sysvar_account_info,
        )?;

        if instruction.program_id != crate::ID {
            // we treat any instruction including that pool address is other swap ix
            for i in 0..instruction.accounts.len() {
                if instruction.accounts[i].pubkey.eq(pool) {
                    msg!("Multiple swaps not allowed");
                    return Err(PoolError::FailToValidateSingleSwapInstruction.into());
                }
            }
        } else if instruction.data[..8].eq(SwapInstruction::DISCRIMINATOR) {
            if instruction.accounts[1].pubkey.eq(pool) {
                // otherwise, we just need to search swap instruction discriminator, so creator can still bundle initialzing pool and swap at 1 tx
                msg!("Multiple swaps not allowed");
                return Err(PoolError::FailToValidateSingleSwapInstruction.into());
            }
        }
    }

    Ok(())
}
