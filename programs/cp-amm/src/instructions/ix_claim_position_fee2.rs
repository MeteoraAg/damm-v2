use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::seeds::POOL_AUTHORITY_PREFIX,
    state::{CollectFeeMode, Pool, Position},
    token::transfer_from_pool,
    EvtClaimPositionFee, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ClaimPositionFee2Ctx<'info> {
    /// CHECK: pool authority
    #[account(
        seeds = [
            POOL_AUTHORITY_PREFIX.as_ref(),
        ],
        bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        has_one = token_b_mint,
        has_one = token_b_vault,
    )]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        mut, has_one = pool
    )]
    pub position: AccountLoader<'info, Position>,

    /// The user token b account
    #[account(mut)]
    pub token_b_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token b
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The token account for nft
    #[account(
            constraint = position_nft_account.mint == position.load()?.nft_mint,
            constraint = position_nft_account.amount == 1,
            token::authority = owner
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// owner of position
    pub owner: Signer<'info>,

    /// Token b program
    pub token_b_program: Interface<'info, TokenInterface>,

    /// The vault token account for input token
    #[account(mut)]
    pub token_a_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// The user token a account
    #[account(mut)]
    pub token_a_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,

    /// The mint of token a
    pub token_a_mint: Option<Box<InterfaceAccount<'info, Mint>>>,

    /// Token a program
    pub token_a_program: Option<Interface<'info, TokenInterface>>,
}

impl<'info> ClaimPositionFee2Ctx<'info> {
    pub fn validate(&self) -> Result<()> {
        let pool = self.pool.load()?;

        let collect_fee_mode = CollectFeeMode::try_from(pool.collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        if collect_fee_mode == CollectFeeMode::BothToken {
            // require option accounts
            require!(self.token_a_vault.is_some(), PoolError::MissingAccount);
            require!(self.token_a_account.is_some(), PoolError::MissingAccount);
            require!(self.token_a_mint.is_some(), PoolError::MissingAccount);
            require!(self.token_a_program.is_some(), PoolError::MissingAccount);

            // validate account
            require_keys_eq!(
                pool.token_a_vault,
                self.token_a_vault.clone().unwrap().key()
            );

            require_keys_eq!(pool.token_a_mint, self.token_a_mint.clone().unwrap().key());
        }

        Ok(())
    }
}

pub fn handle_claim_position_fee2(ctx: Context<ClaimPositionFee2Ctx>) -> Result<()> {
    // validate
    ctx.accounts.validate()?;

    let mut position = ctx.accounts.position.load_mut()?;

    let pool = ctx.accounts.pool.load()?;
    position.update_fee(pool.fee_a_per_liquidity(), pool.fee_b_per_liquidity())?;
    // update metrics
    let fee_a_pending = position.fee_a_pending;
    let fee_b_pending = position.fee_b_pending;
    position
        .metrics
        .accumulate_claimed_fee(fee_a_pending, fee_b_pending)?;

    if fee_a_pending > 0 {
        // send to user
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_a_mint.clone().unwrap(),
            &ctx.accounts.token_a_vault.clone().unwrap(),
            &ctx.accounts.token_a_account.clone().unwrap(),
            &ctx.accounts.token_a_program.clone().unwrap(),
            fee_a_pending,
            ctx.bumps.pool_authority,
        )?;
    }

    if fee_b_pending > 0 {
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_b_account,
            &ctx.accounts.token_b_program,
            fee_b_pending,
            ctx.bumps.pool_authority,
        )?;
    }

    position.reset_pending_fee();

    emit_cpi!(EvtClaimPositionFee {
        pool: ctx.accounts.pool.key(),
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.owner.key(),
        fee_a_claimed: fee_a_pending,
        fee_b_claimed: fee_b_pending,
    });

    Ok(())
}
