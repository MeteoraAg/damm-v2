use anchor_lang::prelude::*;

use crate::state::{Operator, Pool};

#[derive(Accounts)]
pub struct FixPoolLayoutVersionCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_fix_pool_layout_version(ctx: Context<FixPoolLayoutVersionCtx>) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.update_layout_version_if_needed()?;
    Ok(())
}
