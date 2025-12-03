use anchor_lang::prelude::*;

use crate::{
    constants::seeds::CLAIM_FEE_OPERATOR_PREFIX,
    state::{ClaimFeeOperator, Operator, OperatorPermission},
    EvtCreateClaimFeeOperator, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreateClaimFeeOperatorCtx<'info> {
    #[account(
        init,
        payer = payer,
        seeds = [
            CLAIM_FEE_OPERATOR_PREFIX.as_ref(),
            claim_fee_operator_address.key().as_ref(),
        ],
        bump,
        space = 8 + ClaimFeeOperator::INIT_SPACE
    )]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// CHECK: operator
    pub claim_fee_operator_address: UncheckedAccount<'info>,

    #[account(
        has_one = whitelisted_address,
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub whitelisted_address: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_claim_fee_operator(ctx: Context<CreateClaimFeeOperatorCtx>) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;
    require!(
        operator.is_permission_allow(OperatorPermission::CreateClaimProtocolFeeOperator),
        PoolError::InvalidAuthority
    );

    let mut claim_fee_operator = ctx.accounts.claim_fee_operator.load_init()?;
    claim_fee_operator.initialize(ctx.accounts.claim_fee_operator_address.key())?;

    emit_cpi!(EvtCreateClaimFeeOperator {
        operator: ctx.accounts.claim_fee_operator.key(),
    });

    Ok(())
}
