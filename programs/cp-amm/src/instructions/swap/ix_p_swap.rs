use crate::const_pda::{EVENT_AUTHORITY_AND_BUMP, EVENT_AUTHORITY_SEEDS};
use crate::p_helper::{
    p_accessor_mint, p_load_mut_unchecked, p_transfer_from_pool, p_transfer_from_user,
};
use crate::state::CollectFeeMode;
use crate::{
    process_swap_exact_in, process_swap_exact_out, process_swap_partial_fill, EvtSwap2,
    ProcessSwapParams, ProcessSwapResult, SwapCtx,
};
use anchor_lang::prelude::*;
use pinocchio::account_info::AccountInfo;

use crate::safe_math::SafeCast;
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
    _remaining_accounts: &[AccountInfo],
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
    let mut pool: pinocchio::account_info::RefMut<'_, Pool> = p_load_mut_unchecked(pool)?;

    {
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&Pubkey::new_from_array(*payer.key())),
            PoolError::PoolDisabled
        );
    }

    pool.update_layout_version_if_needed()?;

    let &SwapParameters2 {
        amount_0,
        amount_1,
        swap_mode,
    } = params;

    let swap_mode = SwapMode::try_from(swap_mode).map_err(|_| PoolError::InvalidInput)?;

    let trade_direction = get_trade_direction(&input_token_account, token_a_mint)?;
    let (
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    ) = match trade_direction {
        TradeDirection::AtoB => (
            token_a_mint,
            token_b_mint,
            token_a_vault,
            token_b_vault,
            token_a_program,
            token_b_program,
        ),
        TradeDirection::BtoA => (
            token_b_mint,
            token_a_mint,
            token_b_vault,
            token_a_vault,
            token_b_program,
            token_a_program,
        ),
    };

    // redundant validation, but we can just keep it
    require!(amount_0 > 0, PoolError::AmountIsZero);

    let has_referral = referral_token_account.key().ne(crate::ID.as_array());

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(current_timestamp)?;

    let collect_fee_mode: CollectFeeMode = pool.collect_fee_mode.safe_cast()?;
    let fee_mode = FeeMode::get_fee_mode(collect_fee_mode, trade_direction, has_referral);

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
        mut swap_result,
        included_transfer_fee_amount_in,
        excluded_transfer_fee_amount_out,
        included_transfer_fee_amount_out,
    } = match swap_mode {
        SwapMode::ExactIn => process_swap_exact_in(process_swap_params),
        SwapMode::PartialFill => process_swap_partial_fill(process_swap_params),
        SwapMode::ExactOut => process_swap_exact_out(process_swap_params),
    }?;

    pool.apply_swap_result(&swap_result, &fee_mode, trade_direction, current_timestamp)?;

    // re-update next_sqrt_price for compounding pool
    swap_result.next_sqrt_price = pool.sqrt_price;

    // send to reserve
    p_transfer_from_user(
        payer,
        token_in_mint,
        input_token_account,
        input_vault_account,
        input_program,
        included_transfer_fee_amount_in,
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
                swap_result.referral_fee,
            )
            .map_err(|err| ProgramError::from(u64::from(err)))?;
        } else {
            p_transfer_from_pool(
                pool_authority,
                token_b_mint,
                token_b_vault,
                referral_token_account,
                token_b_program,
                swap_result.referral_fee,
            )
            .map_err(|err| ProgramError::from(u64::from(err)))?;
        }
    }

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
            reserve_a_amount: pool.token_a_amount,
            reserve_b_amount: pool.token_b_amount,
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
            EVENT_AUTHORITY_SEEDS,
            &[EVENT_AUTHORITY_AND_BUMP.1]
        ))],
    )
}
