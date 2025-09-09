use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    constants::{treasury, DEFAULT_QUOTE_MINTS},
    state::{ClaimFeeOperator, Pool, WhitelistedProtocolFeeReceiver},
    token::transfer_from_pool,
    EvtClaimProtocolFee, PoolError,
};

/// Accounts for withdraw protocol fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolFeesCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut, has_one = token_a_vault, has_one = token_b_vault, has_one = token_a_mint, has_one = token_b_mint)]
    pub pool: AccountLoader<'info, Pool>,

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

    /// The treasury token a account
    #[account(
        mut,
        associated_token::authority = whitelist_protocol_fee_receiver_a.as_ref().map(|account| account.address).unwrap_or(treasury::ID),
        associated_token::mint = token_a_mint,
        associated_token::token_program = token_a_program,
    )]
    pub token_a_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The treasury token b account
    #[account(
        mut,
        associated_token::authority = whitelist_protocol_fee_receiver_b.as_ref().map(|account| account.address).unwrap_or(treasury::ID),
        associated_token::mint = token_b_mint,
        associated_token::token_program = token_b_program,
    )]
    pub token_b_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Claim fee operator
    #[account(has_one = operator)]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// Operator
    pub operator: Signer<'info>,

    /// Token a program
    pub token_a_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_b_program: Interface<'info, TokenInterface>,

    ///
    pub whitelist_protocol_fee_receiver_a: Option<Account<'info, WhitelistedProtocolFeeReceiver>>,
    ///
    pub whitelist_protocol_fee_receiver_b: Option<Account<'info, WhitelistedProtocolFeeReceiver>>,
}

fn validate_protocol_fee_receiver<'info>(
    receiver_token: &TokenAccount,
    whitelist_protocol_fee_receiver: Option<&Account<'info, WhitelistedProtocolFeeReceiver>>,
) -> Result<()> {
    // If the receiver is the Meteora treasury, it's always allowed
    if receiver_token.owner.eq(&treasury::ID) {
        return Ok(());
    }

    // If not the Meteora treasury, must be whitelisted
    require!(
        whitelist_protocol_fee_receiver.is_some(),
        PoolError::InvalidFeeOwner
    );

    // Must be approved by all admins
    let whitelisted_protocol_fee_receiver = whitelist_protocol_fee_receiver.unwrap();
    require!(
        whitelisted_protocol_fee_receiver.approved(),
        PoolError::InvalidFeeOwner
    );

    // And, must not claim SOL/USDC
    require!(
        !DEFAULT_QUOTE_MINTS
            .iter()
            .any(|&m| m.eq(&receiver_token.mint)),
        PoolError::InvalidTokenMint
    );

    Ok(())
}

/// Withdraw protocol fees. Permissionless.
pub fn handle_claim_protocol_fee(
    ctx: Context<ClaimProtocolFeesCtx>,
    max_amount_a: u64,
    max_amount_b: u64,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let (token_a_amount, token_b_amount) = pool.claim_protocol_fee(max_amount_a, max_amount_b)?;

    validate_protocol_fee_receiver(
        ctx.accounts.token_a_account.as_ref(),
        ctx.accounts.whitelist_protocol_fee_receiver_a.as_ref(),
    )?;

    validate_protocol_fee_receiver(
        ctx.accounts.token_b_account.as_ref(),
        ctx.accounts.whitelist_protocol_fee_receiver_b.as_ref(),
    )?;

    if token_a_amount > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_a_account,
            &ctx.accounts.token_a_program,
            token_a_amount,
        )?;
    }

    if token_b_amount > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_b_account,
            &ctx.accounts.token_b_program,
            token_b_amount,
        )?;
    }

    emit_cpi!(EvtClaimProtocolFee {
        pool: ctx.accounts.pool.key(),
        token_a_amount,
        token_b_amount
    });

    Ok(())
}
