use anchor_lang::prelude::*;

use crate::{
    event,
    state::{Config, Operator, OperatorPermission},
    PoolError,
};

#[event_cpi]
#[derive(Accounts)]

pub struct CloseConfigCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub config: AccountLoader<'info, Config>,

    #[account(
        has_one = whitelisted_address
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub whitelisted_address: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_config(ctx: Context<CloseConfigCtx>) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;
    require!(
        operator.is_permission_allow(OperatorPermission::RemoveConfigKey),
        PoolError::InvalidAuthority
    );
    emit_cpi!(event::EvtCloseConfig {
        config: ctx.accounts.config.key(),
        admin: ctx.accounts.whitelisted_address.key(),
    });

    Ok(())
}
