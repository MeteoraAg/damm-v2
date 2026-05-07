use crate::state::{Operator, TokenBadge};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct CloseTokenBadgeCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub token_badge: AccountLoader<'info, TokenBadge>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_token_badge(_ctx: Context<CloseTokenBadgeCtx>) -> Result<()> {
    // Anchor do everything
    Ok(())
}
