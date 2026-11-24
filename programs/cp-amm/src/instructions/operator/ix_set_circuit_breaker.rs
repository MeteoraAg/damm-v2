use anchor_lang::prelude::*;

use crate::{
    state::{ActionGroup, CircuitBreaker, Operator},
    utils::bits::bitmask_max,
    EvtSetCircuitBreaker, PoolError,
};

#[derive(Accounts)]
pub struct SetCircuitBreakerCtx<'info> {
    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    /// The circuit breaker is stored in the event authority
    #[account(mut, address = crate::EVENT_AUTHORITY_AND_BUMP.0)]
    pub event_authority: AccountLoader<'info, CircuitBreaker>,

    /// CHECK: manually add program account (normally from event_cpi macro)
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

/// Replaces the whole bitmask, so several [ActionGroup]s change in one atomic write.
/// `expected_nonce` is the nonce the client read when building the transaction, see
/// [CircuitBreaker::nonce]
pub fn handle_set_circuit_breaker(
    ctx: Context<SetCircuitBreakerCtx>,
    disabled_actions: u64,
    expected_nonce: u64,
) -> Result<()> {
    require!(
        u128::from(disabled_actions) <= bitmask_max(ActionGroup::VARIANT_COUNT),
        PoolError::InvalidParameters
    );

    let mut circuit_breaker = ctx.accounts.event_authority.load_mut()?;
    require!(
        circuit_breaker.nonce == expected_nonce,
        PoolError::UnexpectedCircuitBreakerState
    );
    let old_disabled_actions = circuit_breaker.disabled_actions;
    require!(
        disabled_actions != old_disabled_actions,
        PoolError::InvalidParameters
    );
    circuit_breaker.disabled_actions = disabled_actions;
    // only compared for equality, so wrapping after 2^64 updates is harmless and never blocks an update
    circuit_breaker.nonce = circuit_breaker.nonce.wrapping_add(1);
    let nonce = circuit_breaker.nonce;

    drop(circuit_breaker);

    emit_cpi!(EvtSetCircuitBreaker {
        signer: ctx.accounts.signer.key(),
        old_disabled_actions,
        disabled_actions,
        nonce,
    });

    Ok(())
}
