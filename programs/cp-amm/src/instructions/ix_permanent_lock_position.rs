use anchor_lang::prelude::*;

use crate::{
    state::{Pool, Position},
    EvtPermanentLockPosition,
};

#[event_cpi]
#[derive(Accounts)]
pub struct PermanentLockPositionCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut, has_one = pool, has_one = owner)]
    pub position: AccountLoader<'info, Position>,

    pub owner: Signer<'info>,
}

pub fn handle_permanent_lock_position(
    ctx: Context<PermanentLockPositionCtx>,
    permanent_lock_liquidity: u128,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut position = ctx.accounts.position.load_mut()?;

    position.permanent_lock_liquidity(permanent_lock_liquidity)?;
    pool.accumulate_permanent_locked_liquidity(permanent_lock_liquidity)?;

    emit_cpi!(EvtPermanentLockPosition {
        pool: ctx.accounts.pool.key(),
        position: ctx.accounts.position.key(),
        liquidity: permanent_lock_liquidity,
        pool_new_permanent_locked_liquidity: pool.permanent_lock_liquidity
    });

    Ok(())
}
