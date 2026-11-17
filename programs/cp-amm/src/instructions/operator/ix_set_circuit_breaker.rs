use anchor_lang::prelude::*;

use crate::{
    const_pda,
    state::{ActionGroup, CircuitBreaker, Operator},
    utils::bits::bitmask_max,
    EvtSetCircuitBreaker, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct SetCircuitBreakerCtx<'info> {
    /// The circuit breaker is stored in the pool authority
    #[account(mut, address = const_pda::pool_authority::ID)]
    pub pool_authority: AccountLoader<'info, CircuitBreaker>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_set_circuit_breaker(
    ctx: Context<SetCircuitBreakerCtx>,
    disabled_actions: u64,
    expected_nonce: u64,
) -> Result<()> {
    require!(
        u128::from(disabled_actions) <= bitmask_max(ActionGroup::VARIANT_COUNT),
        PoolError::InvalidParameters
    );

    let mut circuit_breaker = ctx.accounts.pool_authority.load_mut()?;
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

    emit_cpi!(EvtSetCircuitBreaker {
        signer: ctx.accounts.signer.key(),
        old_disabled_actions,
        disabled_actions,
        nonce: circuit_breaker.nonce,
    });

    Ok(())
}
