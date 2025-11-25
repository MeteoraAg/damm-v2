use crate::p_helper::{
    p_accessor_mint, p_load_mut_unchecked, p_transfer_from_pool, p_transfer_from_user,
};
use crate::state::SwapResult2;
use crate::{instruction::Swap as SwapInstruction, instruction::Swap2 as Swap2Instruction};
use crate::{
    process_swap_exact_in, process_swap_exact_out, process_swap_partial_fill, EvtSwap2,
    ProcessSwapParams, ProcessSwapResult, SwapCtx,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{
    get_processed_sibling_instruction, get_stack_height, Instruction,
};
use pinocchio::account_info::AccountInfo;
use pinocchio::sysvars::instructions::{Instructions, IntrospectedInstruction, INSTRUCTIONS_ID};

use crate::safe_math::SafeMath;
use crate::{
    activation_handler::ActivationHandler,
    get_pool_access_validator,
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool},
    PoolError, SwapMode, SwapParameters2,
};

// 14 accounts are calculated from SwapCtx accounts + event authority account + program account
pub const SWAP_IX_ACCOUNTS: usize = 14;

/// Get the trading direction of the current swap. Eg: USDT -> USDC
pub fn get_trade_direction(
    input_token_account: &AccountInfo,
    token_a_mint: &AccountInfo,
) -> Result<TradeDirection> {
    let input_token_account_mint = p_accessor_mint(input_token_account)?;
    if input_token_account_mint.as_array() == token_a_mint.key() {
        Ok(TradeDirection::AtoB)
    } else {
        Ok(TradeDirection::BtoA)
    }
}

/// A pinocchio equivalent of the above handle_swap
pub fn p_handle_swap(
    _program_id: &pinocchio::pubkey::Pubkey,
    accounts: &[AccountInfo],
    remaining_accounts: &[AccountInfo],
    params: &SwapParameters2,
) -> Result<()> {
    //validate accounts to match with anchor macro
    SwapCtx::validate_p_accounts(accounts)?;

    let [
        pool_authority,
        // #[account(mut, has_one = token_a_vault, has_one = token_b_vault)]
        pool,
        input_token_account,
        output_token_account,
        // #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
        token_a_vault,
        // #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
        token_b_vault,
        token_a_mint,
        token_b_mint,
        payer,
        token_a_program,
        token_b_program,
        referral_token_account,
        event_authority,
        _program,
        ..
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys.into());
    };

    let pool_key = pool.key();
    let pool: &mut Pool = p_load_mut_unchecked(pool)?;

    {
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&Pubkey::new_from_array(*payer.key())),
            PoolError::PoolDisabled
        );
    }

    let &SwapParameters2 {
        amount_0,
        amount_1,
        swap_mode,
    } = params;

    let swap_mode = SwapMode::try_from(swap_mode).map_err(|_| PoolError::InvalidInput)?;

    let token_a_flag = pool.token_a_flag;
    let token_b_flag = pool.token_b_flag;
    let trade_direction = get_trade_direction(&input_token_account, token_a_mint)?;
    let (
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
        input_token_flag,
        output_token_flag,
    ) = match trade_direction {
        TradeDirection::AtoB => (
            token_a_mint,
            token_b_mint,
            token_a_vault,
            token_b_vault,
            token_a_program,
            token_b_program,
            token_a_flag,
            token_b_flag,
        ),
        TradeDirection::BtoA => (
            token_b_mint,
            token_a_mint,
            token_b_vault,
            token_a_vault,
            token_b_program,
            token_a_program,
            token_b_flag,
            token_a_flag,
        ),
    };

    // redundant validation, but we can just keep it
    require!(amount_0 > 0, PoolError::AmountIsZero);

    let has_referral = referral_token_account.key().ne(crate::ID.as_array());

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    // another validation to prevent snipers to craft multiple swap instructions in 1 tx
    // (if we dont do this, they are able to concat 16 swap instructions in 1 tx)
    if let Ok(rate_limiter) = pool.pool_fees.base_fee.to_fee_rate_limiter() {
        if rate_limiter.is_rate_limiter_applied(
            current_point,
            pool.activation_point,
            trade_direction,
        )? {
            validate_single_swap_instruction(
                &Pubkey::new_from_array(*pool_key),
                remaining_accounts,
            )?;
        }
    }

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(current_timestamp)?;

    let fee_mode = FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let process_swap_params = ProcessSwapParams {
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
    } = match swap_mode {
        SwapMode::ExactIn => process_swap_exact_in(process_swap_params),
        SwapMode::PartialFill => process_swap_partial_fill(process_swap_params),
        SwapMode::ExactOut => process_swap_exact_out(process_swap_params),
    }?;

    pool.apply_swap_result(&swap_result, &fee_mode, current_timestamp)?;

    let SwapResult2 { referral_fee, .. } = swap_result;

    // send to reserve
    p_transfer_from_user(
        payer,
        token_in_mint,
        input_token_account,
        input_vault_account,
        input_program,
        included_transfer_fee_amount_in,
        input_token_flag,
    )
    .map_err(|err| ProgramError::from(u64::from(err)))?;
    // send to user
    p_transfer_from_pool(
        pool_authority,
        &token_out_mint,
        &output_vault_account,
        &output_token_account,
        output_program,
        included_transfer_fee_amount_out,
        output_token_flag,
    )
    .map_err(|err| ProgramError::from(u64::from(err)))?;
    // send to referral
    if has_referral {
        if fee_mode.fees_on_token_a {
            p_transfer_from_pool(
                pool_authority,
                token_a_mint,
                token_a_vault,
                referral_token_account,
                token_a_program,
                referral_fee,
                token_a_flag,
            )
            .map_err(|err| ProgramError::from(u64::from(err)))?;
        } else {
            p_transfer_from_pool(
                pool_authority,
                token_b_mint,
                token_b_vault,
                referral_token_account,
                token_b_program,
                referral_fee,
                token_b_flag,
            )
            .map_err(|err| ProgramError::from(u64::from(err)))?;
        }
    }

    let (reserve_a_amount, reserve_b_amount) = pool.get_reserves_amount()?;

    p_emit_cpi(
        anchor_lang::Event::data(&EvtSwap2 {
            pool: Pubkey::new_from_array(*pool_key),
            trade_direction: trade_direction.into(),
            collect_fee_mode: pool.collect_fee_mode,
            has_referral,
            params: *params,
            swap_result,
            current_timestamp,
            included_transfer_fee_amount_in,
            included_transfer_fee_amount_out,
            excluded_transfer_fee_amount_out,
            reserve_a_amount,
            reserve_b_amount,
        }),
        event_authority,
    )
    .map_err(|err| ProgramError::from(u64::from(err)))?;

    Ok(())
}

fn p_emit_cpi(inner_data: Vec<u8>, authority_info: &AccountInfo) -> pinocchio::ProgramResult {
    let disc = anchor_lang::event::EVENT_IX_TAG_LE;
    let ix_data: Vec<u8> = disc
        .into_iter()
        .map(|b| *b)
        .chain(inner_data.into_iter())
        .collect();
    let instruction = pinocchio::instruction::Instruction {
        program_id: crate::ID.as_array(),
        data: &ix_data,
        accounts: &[pinocchio::instruction::AccountMeta::new(
            authority_info.key(),
            false,
            true,
        )],
    };

    pinocchio::cpi::invoke_signed(
        &instruction,
        &[authority_info],
        &[pinocchio::instruction::Signer::from(&pinocchio::seeds!(
            crate::EVENT_AUTHORITY_SEEDS,
            &[crate::EVENT_AUTHORITY_AND_BUMP.1]
        ))],
    )
}

pub fn validate_single_swap_instruction<'c, 'info>(
    pool: &Pubkey,
    remaining_accounts: &'c [AccountInfo],
) -> Result<()> {
    let instruction_sysvar_account_info = remaining_accounts
        .get(0)
        .ok_or_else(|| PoolError::FailToValidateSingleSwapInstruction)?;
    if &INSTRUCTIONS_ID != instruction_sysvar_account_info.key() {
        return Err(ProgramError::UnsupportedSysvar.into());
    }

    let instruction_sysvar = instruction_sysvar_account_info
        .try_borrow_data()
        .map_err(|err| ProgramError::from(u64::from(err)))?;
    let instruction_sysvar_instructions =
        unsafe { Instructions::new_unchecked(instruction_sysvar) };
    let current_index = instruction_sysvar_instructions.load_current_index();
    let current_instruction = instruction_sysvar_instructions
        .load_instruction_at(current_index.into())
        .map_err(|err| ProgramError::from(u64::from(err)))?;

    if current_instruction.get_program_id() != crate::ID.as_array() {
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
        let instruction = instruction_sysvar_instructions
            .load_instruction_at(i.into())
            .map_err(|err| ProgramError::from(u64::from(err)))?;

        if instruction.get_program_id() != crate::ID.as_array() {
            // we treat any instruction including that pool address is other swap ix
            loop {
                match instruction.get_account_meta_at(i.into()) {
                    Ok(account_metadata) => {
                        if &account_metadata.key == pool.as_array() {
                            msg!("Multiple swaps not allowed");
                            return Err(PoolError::FailToValidateSingleSwapInstruction.into());
                        }
                    }
                    Err(err) => {
                        if err == pinocchio::program_error::ProgramError::InvalidArgument {
                            break;
                        } else {
                            return Err(PoolError::UndeterminedError.into());
                        }
                    }
                }
            }
        } else {
            require!(
                !is_p_instruction_include_pool_swap(&instruction, pool)?,
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

fn is_p_instruction_include_pool_swap(
    instruction: &IntrospectedInstruction,
    pool: &Pubkey,
) -> Result<bool> {
    let instruction_data = instruction.get_instruction_data();
    let instruction_discriminator = &instruction_data[..8];
    if instruction_discriminator.eq(SwapInstruction::DISCRIMINATOR)
        || instruction_discriminator.eq(Swap2Instruction::DISCRIMINATOR)
    {
        let account_metadata = instruction
            .get_account_meta_at(1)
            .map_err(|err| ProgramError::from(u64::from(err)))?;
        return Ok(&account_metadata.key == pool.as_array());
    }
    Ok(false)
}
