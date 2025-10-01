use crate::{assert_eq_admin, state::WhitelistedProtocolFeeReceiver};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseWhitelistProtocolFeeReceiver<'info> {
    #[account(
        mut,
        close = rent_receiver
    )]
    pub whitelist_protocol_fee_receiver: Account<'info, WhitelistedProtocolFeeReceiver>,

    /// CHECK: This is not dangerous. We are only transferring lamports to this account.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,

    #[account(
        constraint = assert_eq_admin(admin.key())
    )]
    pub admin: Signer<'info>,
}

pub fn handle_close_whitelist_protocol_fee_receiver(
    _ctx: Context<CloseWhitelistProtocolFeeReceiver>,
) -> Result<()> {
    Ok(())
}
