use anchor_lang::prelude::*;

use crate::{
    state::{CircuitBreaker, Operator},
    EvtCloseCircuitBreaker, PoolError,
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

    /// CHECK: manually add program account (normally from event_cpi macro)
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

pub fn handle_close_circuit_breaker(
    ctx: Context<CloseCircuitBreakerCtx>,
    expected_nonce: u64,
) -> Result<()> {
    let circuit_breaker = ctx.accounts.event_authority.load()?;
    require!(
        circuit_breaker.nonce == expected_nonce,
        PoolError::UnexpectedCircuitBreakerState
    );
    require!(
        circuit_breaker.disabled_actions == 0,
        PoolError::CircuitBreakerHasDisabledActions
    );
    let nonce = circuit_breaker.nonce;

    drop(circuit_breaker);

    emit_cpi!(EvtCloseCircuitBreaker {
        signer: ctx.accounts.signer.key(),
        nonce,
    });

    Ok(())
}
