use crate::{
    state::{Operator, OperatorPermission, TokenBadge},
    PoolError,
};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct CloseTokenBadgeCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub token_badge: AccountLoader<'info, TokenBadge>,

    #[account(
        has_one = whitelisted_address,
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub whitelisted_address: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_token_badge(ctx: Context<CloseTokenBadgeCtx>) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;
    require!(
        operator.is_permission_allow(OperatorPermission::CloseTokenBadge),
        PoolError::InvalidAuthority
    );
    Ok(())
}
