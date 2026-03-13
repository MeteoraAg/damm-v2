use crate::token::{get_token_program_from_flag, validate_ata_token};
use crate::PoolError;
use crate::{
    const_pda,
    constants::treasury as TREASURY,
    state::{Operator, Pool},
    token::transfer_from_pool,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as SYSVAR_IX_ID;

use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use protocol_zap::constants::MINTS_DISALLOWED_TO_ZAP_OUT;
use protocol_zap::utils::validate_zap_out_to_treasury;

/// Accounts for zap protocol fees
#[derive(Accounts)]
pub struct ZapProtocolFee<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut)]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Receiver token account to receive the zap out fund.
    #[account(mut)]
    pub receiver_token: UncheckedAccount<'info>,

    /// zap claim fee operator
    pub operator: AccountLoader<'info, Operator>,

    /// Operator
    pub signer: Signer<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: Sysvar Instructions account
    #[account(
        address = SYSVAR_IX_ID,
    )]
    pub sysvar_instructions: AccountInfo<'info>,
}

fn validate_accounts_and_return_withdraw_direction<'info>(
    pool: &Pool,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<bool> {
    require!(
        token_mint.key() == pool.token_a_mint || token_mint.key() == pool.token_b_mint,
        PoolError::InvalidWithdrawProtocolFeeZapAccounts
    );

    let is_withdrawing_token_a = token_mint.key() == pool.token_a_mint;

    if is_withdrawing_token_a {
        require!(
            token_vault.key() == pool.token_a_vault,
            PoolError::InvalidWithdrawProtocolFeeZapAccounts
        );
    } else {
        require!(
            token_vault.key() == pool.token_b_vault,
            PoolError::InvalidWithdrawProtocolFeeZapAccounts
        );
    }

    let token_mint_ai = token_mint.to_account_info();
    require!(
        *token_mint_ai.owner == token_program.key(),
        PoolError::InvalidWithdrawProtocolFeeZapAccounts
    );

    Ok(is_withdrawing_token_a)
}

// Rules:
// 1. If the token mint is SOL or USDC, then must withdraw to treasury using `claim_protocol_fee` endpoint. No zap out allowed.
// 2. If the token mint is not SOL or USDC, operator require to zap out to SOL or USDC or either one of the token of the pool
pub fn handle_zap_protocol_fee(ctx: Context<ZapProtocolFee>, max_amount: u64) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let is_withdrawing_a = validate_accounts_and_return_withdraw_direction(
        &pool,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )?;

    require!(
        !MINTS_DISALLOWED_TO_ZAP_OUT.contains(&ctx.accounts.token_mint.key().to_bytes()),
        PoolError::MintRestrictedFromZap
    );

    let (amount, treasury_paired_destination_token_address) = if is_withdrawing_a {
        let (amount_a, _) = pool.claim_protocol_fee(max_amount, 0)?;

        let treasury_token_b_address = get_associated_token_address_with_program_id(
            &TREASURY::ID,
            &pool.token_b_mint,
            &get_token_program_from_flag(pool.token_b_flag)?,
        );
        (amount_a, treasury_token_b_address)
    } else {
        let (_, amount_b) = pool.claim_protocol_fee(0, max_amount)?;
        let treasury_token_a_address = get_associated_token_address_with_program_id(
            &TREASURY::ID,
            &pool.token_a_mint,
            &get_token_program_from_flag(pool.token_a_flag)?,
        );
        (amount_b, treasury_token_a_address)
    };

    require!(amount > 0, PoolError::AmountIsZero);

    drop(pool);

    let receiver_token_ai = ctx.accounts.receiver_token.to_account_info();

    validate_ata_token(
        &receiver_token_ai,
        &ctx.accounts.signer.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_program.key(),
    )?;

    validate_zap_out_to_treasury(
        amount,
        &crate::ID.to_bytes(),
        &ctx.accounts.receiver_token.key().to_bytes(),
        &ctx.accounts.receiver_token.try_borrow_data()?,
        &ctx.accounts.sysvar_instructions.try_borrow_data()?,
        &TREASURY::ID.to_bytes(),
        &treasury_paired_destination_token_address.to_bytes(),
    )
    .map_err(|e| -> anchor_lang::error::Error { PoolError::from(e).into() })?;

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &receiver_token_ai,
        &ctx.accounts.token_program,
        amount,
    )?;

    Ok(())
}
