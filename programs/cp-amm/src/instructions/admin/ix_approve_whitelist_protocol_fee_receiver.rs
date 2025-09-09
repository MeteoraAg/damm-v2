use anchor_lang::prelude::*;

use crate::state::WhitelistedProtocolFeeReceiver;

#[derive(Accounts)]
pub struct ApproveWhitelistProtocolFeeReceiver<'info> {
    #[account(mut)]
    pub whitelist_protocol_fee_receiver: Account<'info, WhitelistedProtocolFeeReceiver>,

    pub admin: Signer<'info>,
}

pub fn handle_approve_whitelist_protocol_fee_receiver(
    ctx: Context<ApproveWhitelistProtocolFeeReceiver>,
) -> Result<()> {
    let whitelist_protocol_fee_receiver = &mut ctx.accounts.whitelist_protocol_fee_receiver;
    whitelist_protocol_fee_receiver.approve(ctx.accounts.admin.key())?;

    Ok(())
}
