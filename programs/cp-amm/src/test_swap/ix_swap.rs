use crate::{
    activation_handler::ActivationHandler,
    get_pool_access_validator,
    instruction::{Swap as SwapInstruction, Swap2 as Swap2Instruction},
    params::swap::TradeDirection,
    safe_math::SafeMath,
    state::{fee::FeeMode, Pool, SwapResult2},
    test_swap::{process_swap_exact_in, process_swap_exact_out, process_swap_partial_fill},
    token::{transfer_from_pool, transfer_from_user},
    EvtSwap2, PoolError, ProcessSwapResult, SwapCtx, SwapMode, SwapParameters2,
};
use anchor_lang::solana_program::sysvar;
use anchor_lang::{
    prelude::*,
    solana_program::instruction::{get_stack_height, Instruction},
};
use anchor_spl::token_interface::{Mint, TokenAccount};
use solana_program::instruction::get_processed_sibling_instruction;

pub struct ProcessSwapTestParams<'a, 'b, 'info> {
    pub pool: &'a Pool,
    pub token_in_mint: &'b InterfaceAccount<'info, Mint>,
    pub token_out_mint: &'b InterfaceAccount<'info, Mint>,
    pub fee_mode: &'a FeeMode,
    pub trade_direction: TradeDirection,
    pub current_point: u64,
    pub amount_0: u64,
    pub amount_1: u64,
}

fn get_trade_direction(
    input_token_account: &InterfaceAccount<'_, TokenAccount>,
    token_a_mint: &InterfaceAccount<'_, Mint>,
) -> TradeDirection {
    if input_token_account.mint == token_a_mint.key() {
        return TradeDirection::AtoB;
    }
    TradeDirection::BtoA
}

pub fn handle_test_swap_wrapper(ctx: &Context<SwapCtx>, params: SwapParameters2) -> Result<()> {
    let SwapParameters2 {
        amount_0,
        amount_1,
        swap_mode,
        ..
    } = params;

    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&ctx.accounts.payer.key()),
            PoolError::PoolDisabled
        );
    }

    let swap_mode = SwapMode::try_from(swap_mode).map_err(|_| PoolError::InvalidInput)?;
    let trade_direction = get_trade_direction(
        &ctx.accounts.input_token_account,
        &ctx.accounts.token_a_mint,
    );

    let (
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    ) = match trade_direction {
        TradeDirection::AtoB => (
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_a_program,
            &ctx.accounts.token_b_program,
        ),
        TradeDirection::BtoA => (
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_b_program,
            &ctx.accounts.token_a_program,
        ),
    };

    // redundant validation, but we can just keep it
    require!(amount_0 > 0, PoolError::AmountIsZero);

    let has_referral = ctx.accounts.referral_token_account.is_some();
    let mut pool = ctx.accounts.pool.load_mut()?;
    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    // another validation to prevent snipers to craft multiple swap instructions in 1 tx
    // (if we dont do this, they are able to concat 16 swap instructions in 1 tx)
    if let Ok(rate_limiter) = pool.pool_fees.base_fee.to_fee_rate_limiter() {
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

    let process_swap_params = ProcessSwapTestParams {
        pool: &pool,
        token_in_mint,
        token_out_mint,
        amount_0,
        amount_1,
        fee_mode: &fee_mode,
        trade_direction,
        current_point,
    };

    let ProcessSwapResult {
        swap_result,
        included_transfer_fee_amount_in,
        excluded_transfer_fee_amount_out,
        included_transfer_fee_amount_out,
        ..
    } = match swap_mode {
        SwapMode::ExactIn => process_swap_exact_in(process_swap_params),
        SwapMode::PartialFill => process_swap_partial_fill(process_swap_params),
        SwapMode::ExactOut => process_swap_exact_out(process_swap_params),
    }?;

    pool.apply_swap_result(&swap_result, &fee_mode, current_timestamp)?;

    let SwapResult2 { referral_fee, .. } = swap_result;

    // send to reserve
    transfer_from_user(
        &ctx.accounts.payer,
        token_in_mint,
        &ctx.accounts.input_token_account,
        input_vault_account,
        input_program,
        included_transfer_fee_amount_in,
    )?;

    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        token_out_mint,
        output_vault_account,
        &ctx.accounts.output_token_account,
        output_program,
        included_transfer_fee_amount_out,
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

    let (reserve_a_amount, reserve_b_amount) = pool.get_reserves_amount()?;

    emit_cpi!(EvtSwap2 {
        pool: ctx.accounts.pool.key(),
        trade_direction: trade_direction.into(),
        collect_fee_mode: pool.collect_fee_mode,
        has_referral,
        params,
        swap_result,
        current_timestamp,
        included_transfer_fee_amount_in,
        included_transfer_fee_amount_out,
        excluded_transfer_fee_amount_out,
        reserve_a_amount,
        reserve_b_amount
    });

    Ok(())
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
            if sibling_instruction.program_id == crate::ID {
                require!(
                    !is_instruction_include_pool_swap(&sibling_instruction, pool),
                    PoolError::FailToValidateSingleSwapInstruction
                );
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
        } else {
            require!(
                !is_instruction_include_pool_swap(&instruction, pool),
                PoolError::FailToValidateSingleSwapInstruction
            );
        }
    }

    Ok(())
}

fn is_instruction_include_pool_swap(instruction: &Instruction, pool: &Pubkey) -> bool {
    let instruction_discriminator = &instruction.data[..8];
    if instruction_discriminator.eq(SwapInstruction::DISCRIMINATOR)
        || instruction_discriminator.eq(Swap2Instruction::DISCRIMINATOR)
    {
        return instruction.accounts[1].pubkey.eq(pool);
    }
    false
}
