use anchor_lang::prelude::*;

use crate::{
    base_fee::ZeroRateLimiter,
    state::{Operator, Pool},
    EvtZeroPoolRateLimiter,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ZeroPoolRateLimiterCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_zero_pool_rate_limiter(ctx: Context<ZeroPoolRateLimiterCtx>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let updated = pool.pool_fees.base_fee.base_fee_info.zero_rate_limiter()?;

    if updated {
        emit_cpi!(EvtZeroPoolRateLimiter {
            pool: ctx.accounts.pool.key(),
            operator: ctx.accounts.signer.key(),
        });
    }

    Ok(())
}
