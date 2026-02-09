use crate::{const_pda, state::Pool, token::transfer_from_pool, EvtClaimCreatorFee};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts for claiming creator fees
#[event_cpi]
#[derive(Accounts)]
pub struct ClaimCreatorFeeCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = token_a_vault,
        has_one = token_b_vault,
        has_one = token_a_mint,
        has_one = token_b_mint,
        has_one = creator
    )]
    pub pool: AccountLoader<'info, Pool>,

    /// The creator's token a account
    #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
    pub token_a_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The creator's token b account
    #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
    pub token_b_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for token a
    #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for token b
    #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token a
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of token b
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool creator
    pub creator: Signer<'info>,

    /// Token a program
    pub token_a_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_b_program: Interface<'info, TokenInterface>,
}

/// Claim creator fees from the pool
pub fn handle_claim_creator_fee(
    ctx: Context<ClaimCreatorFeeCtx>,
    max_amount_a: u64,
    max_amount_b: u64,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let (token_a_amount, token_b_amount) = pool.claim_creator_fee(max_amount_a, max_amount_b)?;

    drop(pool);

    if token_a_amount > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_a_account.to_account_info(),
            &ctx.accounts.token_a_program,
            token_a_amount,
        )?;
    }

    if token_b_amount > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_b_account.to_account_info(),
            &ctx.accounts.token_b_program,
            token_b_amount,
        )?;
    }

    emit_cpi!(EvtClaimCreatorFee {
        pool: ctx.accounts.pool.key(),
        creator: ctx.accounts.creator.key(),
        token_a_amount,
        token_b_amount
    });

    Ok(())
}
