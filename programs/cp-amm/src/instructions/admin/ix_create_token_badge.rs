use crate::constants::seeds::TOKEN_BADGE_PREFIX;
use crate::state::*;
use crate::{assert_eq_admin, PoolError};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use token_badge::TokenBadge;
#[derive(Accounts)]
pub struct CreateTokenBadgeCtx<'info> {
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [
            TOKEN_BADGE_PREFIX.as_ref(),
            token_mint.key().as_ref(),
        ],
        bump,
        space = 8 + TokenBadge::INIT_SPACE
    )]
    pub token_badge: AccountLoader<'info, TokenBadge>,

    #[account(
        mut,
        constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_token_badge(ctx: Context<CreateTokenBadgeCtx>) -> Result<()> {
    let mut token_badge = ctx.accounts.token_badge.load_init()?;
    token_badge.initialize(ctx.accounts.token_mint.key())?;
    Ok(())
}
