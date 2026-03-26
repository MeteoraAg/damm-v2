use crate::{
    const_pda,
    state::{Operator, Pool},
    token::transfer_from_pool,
    validate_accounts_and_return_withdraw_direction, EvtClaimProtocolFeeUnchecked, PoolError,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts for withdraw protocol fees unchecked
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolFeeUncheckedCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    /// The vault token account for input token
    #[account(mut, token::mint = token_mint, token::token_program = token_program)]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = token_mint, token::token_program = token_program)]
    pub receiver_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Claim fee operator
    pub operator: AccountLoader<'info, Operator>,

    /// Operator
    pub signer: Signer<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,
}

/// withdraw protocol fees without checking the destination token account
pub fn handle_claim_protocol_fee_unchecked(
    ctx: Context<ClaimProtocolFeeUncheckedCtx>,
    max_amount: u64,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let is_withdrawing_a = validate_accounts_and_return_withdraw_direction(
        &pool,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )
    .ok_or_else(|| error!(PoolError::InvalidClaimProtocolFeeAccounts))?;

    let amount = if is_withdrawing_a {
        let (amount_a, _) = pool.claim_protocol_fee(max_amount, 0)?;
        amount_a
    } else {
        let (_, amount_b) = pool.claim_protocol_fee(0, max_amount)?;
        amount_b
    };

    require!(amount > 0, PoolError::AmountIsZero);

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &ctx.accounts.receiver_token_account.to_account_info(),
        &ctx.accounts.token_program,
        amount,
    )?;

    emit_cpi!(EvtClaimProtocolFeeUnchecked {
        pool: ctx.accounts.pool.key(),
        receiver_token_account: ctx.accounts.receiver_token_account.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
