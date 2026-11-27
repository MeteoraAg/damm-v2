use anchor_lang::prelude::*;

use crate::{
    state::{CircuitBreaker, Operator},
    EvtCloseCircuitBreaker,
};

#[derive(Accounts)]
pub struct CloseCircuitBreakerCtx<'info> {
    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    /// CHECK: rent receiver
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    /// The circuit breaker is stored in the event authority
    #[account(
        mut,
        address = crate::EVENT_AUTHORITY_AND_BUMP.0,
        close = rent_receiver
    )]
    pub event_authority: AccountLoader<'info, CircuitBreaker>,
}

pub fn handle_close_circuit_breaker(ctx: Context<CloseCircuitBreakerCtx>) -> Result<()> {
    emit!(EvtCloseCircuitBreaker {
        signer: ctx.accounts.signer.key(),
    });

    Ok(())
}
