use anchor_lang::prelude::*;

use crate::{
    constants::seeds::POOL_AUTHORITY_PREFIX,
    state::{CircuitBreaker, Operator},
};

#[derive(Accounts)]
pub struct InitializeCircuitBreakerCtx<'info> {
    /// The circuit breaker is stored in the pool authority
    #[account(
        init,
        payer = payer,
        seeds = [POOL_AUTHORITY_PREFIX],
        bump,
        space = CircuitBreaker::DISCRIMINATOR.len() + CircuitBreaker::INIT_SPACE
    )]
    pub pool_authority: AccountLoader<'info, CircuitBreaker>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_circuit_breaker(ctx: Context<InitializeCircuitBreakerCtx>) -> Result<()> {
    ctx.accounts.pool_authority.load_init()?;
    Ok(())
}
