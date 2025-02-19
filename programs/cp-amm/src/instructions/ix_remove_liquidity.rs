use anchor_lang::prelude::*;
use anchor_spl::token_interface::{ Mint, TokenAccount, TokenInterface };

use crate::{
    constants::seeds::POOL_AUTHORITY_PREFIX,
    state::{ ModifyLiquidityResult, Pool, Position },
    token::transfer_from_pool,
    u128x128_math::Rounding,
    PoolError,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct RemoveLiquidityParameters {
    /// delta liquidity
    pub liquidity_delta: u128,
    /// minimum token a amount
    pub token_a_amount_threshold: u64,
    /// minimum token b amount
    pub token_b_amount_threshold: u64,
}

#[event_cpi]
#[derive(Accounts)]
pub struct RemoveLiquidityCtx<'info> {
    /// CHECK: pool authority
    #[account(seeds = [POOL_AUTHORITY_PREFIX.as_ref()], bump)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut, has_one = token_a_vault, has_one = token_b_vault, has_one = token_a_mint, has_one = token_b_mint)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
      mut, 
      has_one = pool,
      has_one = owner,
    )]
    pub position: AccountLoader<'info, Position>,

    pub owner: Signer<'info>,

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

pub fn handle_remove_liquidity(ctx: Context<RemoveLiquidityCtx>, params: RemoveLiquidityParameters) -> Result<()> {
    // TODO validate params
    let RemoveLiquidityParameters {
        liquidity_delta,
        token_a_amount_threshold,
        token_b_amount_threshold,
    } = params;

    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut position = ctx.accounts.position.load_mut()?;
    let ModifyLiquidityResult { amount_a, amount_b } = pool.get_amounts_for_modify_liquidity(
        liquidity_delta,
        Rounding::Down
    )?;

    pool.apply_remove_liquidity(&mut position, liquidity_delta)?;

    require!(amount_a >= token_a_amount_threshold, PoolError::ExceededSlippage);
    require!(amount_b >= token_b_amount_threshold, PoolError::ExceededSlippage);

    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_a_vault,
        &ctx.accounts.token_a_account,
        &ctx.accounts.token_a_program,
        amount_a,
        ctx.bumps.pool_authority,
    )?;

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_b_mint,
        &ctx.accounts.token_b_vault,
        &ctx.accounts.token_b_account,
        &ctx.accounts.token_b_program,
        amount_b,
        ctx.bumps.pool_authority,
    )?;

    // TODO emit event

    Ok(())
}
