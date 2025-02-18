use crate::assert_eq_admin;
use crate::event;
use crate::state::config::Config;
use crate::PoolError;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]

pub struct CloseConfigCtx<'info> {
    #[account(
        mut,
        close = admin
    )]
    pub config: AccountLoader<'info, Config>,

    #[account(mut, constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

pub fn handle_close_config(ctx: Context<CloseConfigCtx>) -> Result<()> {
    emit_cpi!(event::EvtCloseConfig {
        config: ctx.accounts.config.key(),
        admin: ctx.accounts.admin.key(),
    });

    Ok(())
}
