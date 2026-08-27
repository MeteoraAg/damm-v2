use anchor_lang::prelude::*;

use crate::{event, state::Config, PoolError};

use super::CreateConfigCtx;

#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub struct DynamicConfigParameters {
    pub pool_creator_authority: Pubkey,
    pub permission: u128,
}

pub fn handle_create_dynamic_config(
    ctx: Context<CreateConfigCtx>,
    index: u64,
    config_parameters: DynamicConfigParameters,
) -> Result<()> {
    let DynamicConfigParameters {
        pool_creator_authority,
        permission,
    } = config_parameters;

    require!(
        pool_creator_authority.ne(&Pubkey::default()),
        PoolError::InvalidPoolCreatorAuthority
    );

    Config::validate_permission(permission, &pool_creator_authority)?;

    let mut config = ctx.accounts.config.load_init()?;
    config.init_dynamic_config(index, pool_creator_authority, permission);

    emit_cpi!(event::EvtCreateDynamicConfig {
        config: ctx.accounts.config.key(),
        pool_creator_authority,
        index,
        permission,
    });

    Ok(())
}
