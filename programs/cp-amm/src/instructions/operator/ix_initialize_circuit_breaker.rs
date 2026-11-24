use anchor_lang::prelude::*;

use crate::{
    const_pda::EVENT_AUTHORITY_SEEDS,
    state::{ActionGroup, CircuitBreaker, Operator},
    utils::bits::bitmask_max,
    EvtInitializeCircuitBreaker, PoolError,
};

#[derive(Accounts)]
pub struct InitializeCircuitBreakerCtx<'info> {
    /// The circuit breaker is stored in the event authority
    #[account(
        init,
        payer = payer,
        seeds = [EVENT_AUTHORITY_SEEDS],
        bump,
        space = CircuitBreaker::DISCRIMINATOR.len() + CircuitBreaker::INIT_SPACE
    )]
    pub event_authority: AccountLoader<'info, CircuitBreaker>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: manually add program account (normally from event_cpi macro)
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

pub fn handle_initialize_circuit_breaker(
    ctx: Context<InitializeCircuitBreakerCtx>,
    disabled_actions: u64,
) -> Result<()> {
    require!(
        u128::from(disabled_actions) <= bitmask_max(ActionGroup::VARIANT_COUNT),
        PoolError::InvalidParameters
    );

    let mut circuit_breaker = ctx.accounts.event_authority.load_init()?;
    circuit_breaker.disabled_actions = disabled_actions;
    circuit_breaker.nonce = Clock::get()?.slot;
    let nonce = circuit_breaker.nonce;

    drop(circuit_breaker);

    emit_cpi!(EvtInitializeCircuitBreaker {
        signer: ctx.accounts.signer.key(),
        disabled_actions,
        nonce,
    });

    Ok(())
}
