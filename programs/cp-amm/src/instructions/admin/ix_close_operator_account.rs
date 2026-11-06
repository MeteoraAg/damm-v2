use crate::{admin::admin::ADMINS, state::Operator, EvtCloseOperatorAccount, PoolError};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct CloseOperatorAccountCtx<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    /// CHECK: Account to receive closed account rental SOL, must be an admin
    #[account(
        mut,
        constraint = ADMINS.contains(&rent_receiver.key()) @ PoolError::InvalidRentReceiver
    )]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_close_operator(ctx: Context<CloseOperatorAccountCtx>) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;

    emit_cpi!(EvtCloseOperatorAccount {
        operator: ctx.accounts.operator.key(),
        whitelisted_address: operator.whitelisted_address,
        permission: operator.permission,
        signer: ctx.accounts.signer.key(),
    });
    Ok(())
}
