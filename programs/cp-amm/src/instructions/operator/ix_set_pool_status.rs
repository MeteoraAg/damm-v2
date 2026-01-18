use anchor_lang::prelude::*;

use crate::{
    event,
    state::{Operator, Pool, PoolStatus},
    PoolError,
};

#[event_cpi]
#[derive(Accounts)]

pub struct SetPoolStatusCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_set_pool_status(ctx: Context<SetPoolStatusCtx>, status: u8) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let new_pool_status = PoolStatus::try_from(status).map_err(|_| PoolError::TypeCastFailed)?;
    let current_pool_status =
        PoolStatus::try_from(pool.pool_status).map_err(|_| PoolError::TypeCastFailed)?;

    require!(
        new_pool_status != current_pool_status,
        PoolError::InvalidPoolStatus
    );
    pool.pool_status = new_pool_status.into();

    emit_cpi!(event::EvtSetPoolStatus {
        pool: ctx.accounts.pool.key(),
        status,
    });

    Ok(())
}
