use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    activation_handler::ActivationHandler,
    const_pda, get_pool_access_validator,
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool},
    token::{calculate_transfer_fee_excluded_amount, transfer_from_pool, transfer_from_user},
    EvtSwap, PoolError,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapParameters {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
}


pub const SWAP_IX_ACCOUNTS: usize = 14;

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
}

// TODO impl swap exact out
pub fn handle_swap(ctx: Context<SwapCtx>, params: SwapParameters) -> Result<()> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&ctx.accounts.payer.key()),
            PoolError::PoolDisabled
        );
    }

    let SwapParameters {
        amount_in,
        minimum_amount_out,
    } = params;

    let trade_direction = ctx.accounts.get_trade_direction();
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

    let transfer_fee_excluded_amount_in =
        calculate_transfer_fee_excluded_amount(&token_in_mint, amount_in)?.amount;

    require!(transfer_fee_excluded_amount_in > 0, PoolError::AmountIsZero);

    let has_referral = ctx.accounts.referral_token_account.is_some();

    let mut pool = ctx.accounts.pool.load_mut()?;

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(current_timestamp)?;

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;
    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = pool.get_swap_result(
        transfer_fee_excluded_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    let transfer_fee_excluded_amount_out =
        calculate_transfer_fee_excluded_amount(&token_out_mint, swap_result.output_amount)?.amount;
    require!(
        transfer_fee_excluded_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    pool.apply_swap_result(&swap_result, fee_mode, current_timestamp)?;

    // send to reserve
    transfer_from_user(
        &ctx.accounts.payer,
        token_in_mint,
        &ctx.accounts.input_token_account,
        &input_vault_account,
        input_program,
        amount_in,
    )?;
    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &token_out_mint,
        &output_vault_account,
        &ctx.accounts.output_token_account,
        output_program,
        swap_result.output_amount,
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
                swap_result.referral_fee,
            )?;
        } else {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.token_b_mint,
                &ctx.accounts.token_b_vault,
                &ctx.accounts.referral_token_account.clone().unwrap(),
                &ctx.accounts.token_b_program,
                swap_result.referral_fee,
            )?;
        }
    }

    emit_cpi!(EvtSwap {
        pool: ctx.accounts.pool.key(),
        trade_direction: trade_direction.into(),
        params,
        swap_result,
        has_referral,
        actual_amount_in: transfer_fee_excluded_amount_in,
        current_timestamp,
    });

    Ok(())
}

pub fn get_trade_direction(
    input_token_account: &pinocchio_token::state::TokenAccount,
    token_a_mint: &pinocchio::account_info::AccountInfo,
) -> TradeDirection {
    if input_token_account.mint() == token_a_mint.key() {
        return TradeDirection::AtoB;
    }
    TradeDirection::BtoA
}

/// A pinocchio equivalent of the above handle_swap
/// 
/// To be done
/// - Verify validation is sufficient
/// - Support token 2022
/// - ...
pub fn p_handle_swap(
    _program_id: &pinocchio::pubkey::Pubkey,
    accounts: &[pinocchio::account_info::AccountInfo],
    data: &[u8],
) -> Result<()> {
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

    // We should return identical errors as anchor on constraints to keep it simple
    require!(payer.is_signer(), PoolError::PoolDisabled);

    let pool_key = pool.key();
    let mut pool_data = pool.try_borrow_mut_data().unwrap();
    
    require!(pool.owner() == &crate::ID.to_bytes(), PoolError::PoolDisabled);
    let pool = pool_load_mut(&mut pool_data).unwrap();
    require!(&pool.token_a_vault.to_bytes() == token_a_vault.key(), PoolError::PoolDisabled);
    require!(&pool.token_b_vault.to_bytes() == token_b_vault.key(), PoolError::PoolDisabled);

    require!(&pool.token_a_mint.to_bytes() == token_a_mint.key(), PoolError::PoolDisabled);
    require!(&pool.token_b_mint.to_bytes() == token_b_mint.key(), PoolError::PoolDisabled);

    require!(token_a_mint.owner() == token_a_program.key(), PoolError::PoolDisabled);
    require!(token_a_mint.owner() == token_b_program.key(), PoolError::PoolDisabled);

    require!(event_authority.key() == &crate::EVENT_AUTHORITY_AND_BUMP.0, PoolError::PoolDisabled);

    {
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&Pubkey::new_from_array(*payer.key())),
            PoolError::PoolDisabled
        );
    }

    let params = SwapParameters::deserialize(&mut &data[8..]).unwrap();
    let SwapParameters {
        amount_in,
        minimum_amount_out,
    } = params;

    let p_input_token_account =
        pinocchio_token::state::TokenAccount::from_account_info(input_token_account).unwrap();
    let trade_direction = get_trade_direction(&p_input_token_account, token_a_mint);
    drop(p_input_token_account);
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

    // let transfer_fee_excluded_amount_in =
    //     calculate_transfer_fee_excluded_amount(&token_in_mint, amount_in)?.amount;
    let transfer_fee_excluded_amount_in = amount_in;

    require!(transfer_fee_excluded_amount_in > 0, PoolError::AmountIsZero);

    let has_referral = referral_token_account.key() != &crate::ID.to_bytes();

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(current_timestamp)?;

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;
    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;

    let swap_result = pool.get_swap_result(
        transfer_fee_excluded_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    // let transfer_fee_excluded_amount_out =
    //     calculate_transfer_fee_excluded_amount(&token_out_mint, swap_result.output_amount)?.amount;
    let transfer_fee_excluded_amount_out = swap_result.output_amount;
    require!(
        transfer_fee_excluded_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    pool.apply_swap_result(&swap_result, fee_mode, current_timestamp)?;

    // send to reserve
    p_transfer_from_user(
        payer,
        token_in_mint,
        input_token_account,
        input_vault_account,
        input_program,
        amount_in,
    )?;
    // send to user
    p_transfer_from_pool(
        pool_authority,
        &token_out_mint,
        &output_vault_account,
        &output_token_account,
        output_program,
        swap_result.output_amount,
    )?;
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
            )?;
        } else {
            p_transfer_from_pool(
                pool_authority,
                token_b_mint,
                token_b_vault,
                referral_token_account,
                token_b_program,
                swap_result.referral_fee,
            )?;
        }
    }

    p_emit_cpi(EvtSwap {
        pool: Pubkey::new_from_array(*pool_key),
        trade_direction: trade_direction.into(),
        params,
        swap_result,
        has_referral,
        actual_amount_in: transfer_fee_excluded_amount_in,
        current_timestamp,
    }, event_authority).unwrap();

    Ok(())
}

pub fn pool_load_mut(data: &mut [u8]) -> Result<&mut Pool> {
    let disc = Pool::DISCRIMINATOR;
    if data.len() < disc.len() {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let given_disc = &data[..disc.len()];
    if given_disc != disc {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }

    Ok(unsafe { &mut *(data[8..].as_mut_ptr() as *mut Pool) })
}

pub fn p_transfer_from_user(
    authority: &pinocchio::account_info::AccountInfo,
    token_mint: &pinocchio::account_info::AccountInfo,
    token_owner_account: &pinocchio::account_info::AccountInfo,
    destination_token_account: &pinocchio::account_info::AccountInfo,
    token_program: &pinocchio::account_info::AccountInfo,
    amount: u64,
) -> Result<()> {
    pinocchio_token::instructions::Transfer {
        from: token_owner_account,
        to: destination_token_account,
        authority,
        amount,
    }
    .invoke()
    .unwrap();
    // let instruction = spl_token_2022::instruction::transfer_checked(
    //     token_program.key,
    //     &token_owner_account.key(),
    //     &token_mint.key(),
    //     destination_account.key,
    //     authority.key,
    //     &[],
    //     amount,
    //     token_mint.decimals,
    // )?;

    // let account_infos = vec![
    //     token_owner_account.to_account_info(),
    //     token_mint.to_account_info(),
    //     destination_account.to_account_info(),
    //     authority.to_account_info(),
    // ];

    // invoke_signed(&instruction, &account_infos, &[])?;

    Ok(())
}

pub fn p_transfer_from_pool(
    pool_authority: &pinocchio::account_info::AccountInfo,
    token_mint: &pinocchio::account_info::AccountInfo,
    token_vault: &pinocchio::account_info::AccountInfo,
    token_owner_account: &pinocchio::account_info::AccountInfo,
    token_program: &pinocchio::account_info::AccountInfo,
    amount: u64,
) -> Result<()> {
    let seeds = pinocchio::seeds!(
        crate::constants::seeds::POOL_AUTHORITY_PREFIX,
        &[crate::const_pda::pool_authority::BUMP]
    );

    pinocchio_token::instructions::Transfer {
        from: token_vault,
        to: token_owner_account,
        authority: pool_authority,
        amount,
    }
    .invoke_signed(&[pinocchio::instruction::Signer::from(&seeds)])
    .unwrap();

    // let instruction = spl_token_2022::instruction::transfer_checked(
    //     token_program.key,
    //     &token_vault.key(),
    //     &token_mint.key(),
    //     &token_owner_account.key(),
    //     &pool_authority.key(),
    //     &[],
    //     amount,
    //     token_mint.decimals,
    // )?;

    // let account_infos = vec![
    //     token_vault.to_account_info(),
    //     token_mint.to_account_info(),
    //     token_owner_account.to_account_info(),
    //     pool_authority.to_account_info(),
    // ];

    // invoke_signed(&instruction, &account_infos, &[&signer_seeds[..]])?;

    Ok(())
}

fn p_emit_cpi(evt_swap: EvtSwap, authority_info: &pinocchio::account_info::AccountInfo) -> pinocchio::ProgramResult {
    let disc = anchor_lang::event::EVENT_IX_TAG_LE;
    let inner_data = anchor_lang::Event::data(&evt_swap);
    let ix_data: Vec<u8> = disc
        .into_iter()
        .map(|b| *b)
        .chain(inner_data.into_iter())
        .collect();
    let instruction = pinocchio::instruction::Instruction { program_id: &crate::ID.to_bytes(), data: &ix_data, accounts: &[
        pinocchio::instruction::AccountMeta::new(authority_info.key(), false, true)
    ] };

    pinocchio::cpi::invoke_signed(&instruction, &[authority_info], &[pinocchio::instruction::Signer::from(&pinocchio::seeds!(crate::EVENT_AUTHORITY_SEEDS, &[crate::EVENT_AUTHORITY_AND_BUMP.1]))])
}