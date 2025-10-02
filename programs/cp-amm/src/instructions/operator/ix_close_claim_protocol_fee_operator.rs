use anchor_lang::prelude::*;

use crate::{
    state::{ClaimFeeOperator, Operator, OperatorPermission},
    EvtCloseClaimFeeOperator, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CloseClaimFeeOperatorCtx<'info> {
    #[account(
        mut,
        close = rent_receiver,
    )]
    pub claim_fee_operator: AccountLoader<'info, ClaimFeeOperator>,

    /// CHECK: rent receiver
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(
        has_one = whitelisted_address
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub whitelisted_address: Signer<'info>,
}

pub fn handle_close_claim_fee_operator(ctx: Context<CloseClaimFeeOperatorCtx>) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;
    require!(
        operator.is_permission_allow(OperatorPermission::CloseClaimProtocolFeeOperator),
        PoolError::InvalidAuthority
    );

    let claim_fee_operator = ctx.accounts.claim_fee_operator.load()?;
    emit_cpi!(EvtCloseClaimFeeOperator {
        claim_fee_operator: ctx.accounts.claim_fee_operator.key(),
        operator: claim_fee_operator.operator,
    });

    Ok(())
}
