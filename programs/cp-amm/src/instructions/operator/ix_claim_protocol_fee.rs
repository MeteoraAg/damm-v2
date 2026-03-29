use crate::{const_pda, state::Pool, token::transfer_from_pool, EvtClaimProtocolFee, PoolError};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts for withdraw protocol fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimProtocolFeeCtx<'info> {
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

    #[account(address = const_pda::protocol_fee_authority::ID)]
    pub signer: Signer<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,
}

fn validate_accounts_and_return_withdraw_direction<'info>(
    pool: &Pool,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<bool> {
    require!(
        token_mint.key() == pool.token_a_mint || token_mint.key() == pool.token_b_mint,
        PoolError::InvalidClaimProtocolFeeAccounts
    );

    let is_withdrawing_token_a = token_mint.key() == pool.token_a_mint;

    if is_withdrawing_token_a {
        require!(
            token_vault.key() == pool.token_a_vault,
            PoolError::InvalidClaimProtocolFeeAccounts
        );
    } else {
        require!(
            token_vault.key() == pool.token_b_vault,
            PoolError::InvalidClaimProtocolFeeAccounts
        );
    }

    let token_mint_ai = token_mint.to_account_info();
    require!(
        *token_mint_ai.owner == token_program.key(),
        PoolError::InvalidClaimProtocolFeeAccounts
    );

    Ok(is_withdrawing_token_a)
}

/// claim protocol fees
pub fn handle_claim_protocol_fee(ctx: Context<ClaimProtocolFeeCtx>, max_amount: u64) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let is_withdrawing_a = validate_accounts_and_return_withdraw_direction(
        &pool,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )?;

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

    emit_cpi!(EvtClaimProtocolFee {
        pool: ctx.accounts.pool.key(),
        receiver_token_account: ctx.accounts.receiver_token_account.key(),
        token_mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}
