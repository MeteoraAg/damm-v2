use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::seeds::POOL_AUTHORITY_PREFIX,
    state::{Pool, Position},
    token::transfer_from_pool,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPositionFee<'info> {
    /// CHECK: pool authority
    #[account(
        seeds = [
            POOL_AUTHORITY_PREFIX.as_ref(),
        ],
        bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// position owner
    pub owner: Signer<'info>,

    #[account(
        has_one = token_a_mint,
        has_one = token_b_mint,
        has_one = token_a_vault,
        has_one = token_b_vault,
    )]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        mut, has_one = pool, has_one = owner
    )]
    pub position: AccountLoader<'info, Position>,

    /// The user token a account
    #[account(mut)]
    pub token_a_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The user token b account
    #[account(mut)]
    pub token_b_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for input token
    #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token a program
    pub token_a_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_b_program: Interface<'info, TokenInterface>,

    /// The mint of token a
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of token b
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle_claim_position_fee(ctx: Context<ClaimPositionFee>) -> Result<()> {
    let mut position = ctx.accounts.position.load_mut()?;

    let pool = ctx.accounts.pool.load()?;
    position.update_fee(pool.fee_a_per_liquidity, pool.fee_b_per_liquidity)?;

    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_a_vault,
        &ctx.accounts.token_a_account,
        &ctx.accounts.token_a_program,
        position.fee_a_pending,
        ctx.bumps.pool_authority,
    )?;

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_b_mint,
        &ctx.accounts.token_b_vault,
        &ctx.accounts.token_b_account,
        &ctx.accounts.token_b_program,
        position.fee_b_pending,
        ctx.bumps.pool_authority,
    )?;

    position.reset_pending_fee();

    // TODO emit event
    Ok(())
}
