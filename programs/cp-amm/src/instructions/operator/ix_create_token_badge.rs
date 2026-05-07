use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::seeds::TOKEN_BADGE_PREFIX,
    state::{Operator, TokenBadge},
    token::is_supported_mint,
    EvtCreateTokenBadge, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateTokenBadgeCtx<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [
            TOKEN_BADGE_PREFIX.as_ref(),
            token_mint.key().as_ref(),
        ],
        bump,
        space = 8 + TokenBadge::INIT_SPACE
    )]
    pub token_badge: AccountLoader<'info, TokenBadge>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_token_badge(ctx: Context<CreateTokenBadgeCtx>) -> Result<()> {
    require!(
        !is_supported_mint(&ctx.accounts.token_mint)?,
        PoolError::CannotCreateTokenBadgeOnSupportedMint
    );
    let mut token_badge = ctx.accounts.token_badge.load_init()?;
    token_badge.initialize(ctx.accounts.token_mint.key())?;

    emit_cpi!(EvtCreateTokenBadge {
        token_mint: ctx.accounts.token_mint.key(),
    });

    Ok(())
}
