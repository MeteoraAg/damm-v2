use anchor_lang::prelude::*;

use crate::{
    event,
    state::{Config, Operator},
};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateConfigPermissionCtx<'info> {
    #[account(mut)]
    pub config: AccountLoader<'info, Config>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_update_config_permission(
    ctx: Context<UpdateConfigPermissionCtx>,
    permission: u128,
) -> Result<()> {
    let mut config = ctx.accounts.config.load_mut()?;

    Config::validate_permission(permission, &config.pool_creator_authority)?;

    config.permission = permission;

    emit_cpi!(event::EvtUpdateConfigPermission {
        config: ctx.accounts.config.key(),
        signer: ctx.accounts.signer.key(),
        permission,
    });

    Ok(())
}
