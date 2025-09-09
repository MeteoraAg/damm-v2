use crate::assert_eq_admin;
use crate::auth::admin::ADMINS;
use crate::constants::seeds::WHITELISTED_PROTOCOL_FEE_RECEIVER;
use crate::state::WhitelistedProtocolFeeReceiver;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CreateWhitelistProtocolFeeReceiver<'info> {
    #[account(
        init,
        payer = payer,
        space = WhitelistedProtocolFeeReceiver::space(ADMINS.len()),
        seeds = [WHITELISTED_PROTOCOL_FEE_RECEIVER, protocol_fee_receiver.key().as_ref()],
        bump
    )]
    pub whitelist_protocol_fee_receiver: Account<'info, WhitelistedProtocolFeeReceiver>,

    /// CHECK: This is not dangerous. We are only storing the key of this account.
    pub protocol_fee_receiver: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        constraint = assert_eq_admin(admin.key())
    )]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_whitelist_protocol_fee_receiver(
    ctx: Context<CreateWhitelistProtocolFeeReceiver>,
) -> Result<()> {
    let whitelist_protocol_fee_receiver = &mut ctx.accounts.whitelist_protocol_fee_receiver;

    whitelist_protocol_fee_receiver.init(
        ctx.accounts.protocol_fee_receiver.key(),
        ADMINS.to_vec(),
        ctx.accounts.admin.key(),
    )?;

    Ok(())
}
