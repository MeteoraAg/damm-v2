use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::seeds::TOKEN_BADGE_PREFIX,
    state::{Operator, TokenBadge},
    PoolError,
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

/// Deprecated: token badges are created in the access-registry program, which `validate_mint` accepts.
/// Existing cp-amm token badges stay valid during the transition and can still be closed.
pub fn handle_create_token_badge(_ctx: Context<CreateTokenBadgeCtx>) -> Result<()> {
    err!(PoolError::DeprecatedEndpoint)
}
