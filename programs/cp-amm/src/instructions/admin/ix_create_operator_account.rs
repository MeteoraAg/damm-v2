use crate::{assert_eq_admin, constants::seeds::OPERATOR_PREFIX, state::Operator, PoolError};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct CreateOperatorAccountCtx<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [
            OPERATOR_PREFIX.as_ref(),
            whitelisted_address.key().as_ref(),
        ],
        bump,
        space = 8 + Operator::INIT_SPACE
    )]
    pub operator: AccountLoader<'info, Operator>,

    /// CHECK: can be any address
    pub whitelisted_address: UncheckedAccount<'info>,

    #[account(
        constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin,
    )]
    pub admin: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_operator(
    ctx: Context<CreateOperatorAccountCtx>,
    permission: u128,
) -> Result<()> {
    // validate permission, only support 10 operations for now
    require!(permission < 1 << 10, PoolError::InvalidPermission);

    let mut operator = ctx.accounts.operator.load_init()?;
    operator.initialize(ctx.accounts.whitelisted_address.key(), permission);
    Ok(())
}
