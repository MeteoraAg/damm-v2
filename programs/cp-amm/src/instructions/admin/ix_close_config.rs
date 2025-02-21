use anchor_lang::prelude::*;

use crate::{assert_eq_admin, event, state::Config, PoolError};

#[event_cpi]
#[derive(Accounts)]

pub struct CloseConfigCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub config: AccountLoader<'info, Config>,

    #[account(mut, constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin)]
    pub admin: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_config(ctx: Context<CloseConfigCtx>) -> Result<()> {
    emit_cpi!(event::EvtCloseConfig {
        config: ctx.accounts.config.key(),
        admin: ctx.accounts.admin.key(),
    });

    Ok(())
}
