use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    state::{Position, PositionDelegatePermission},
    EvtUpdateDelegatePermission, PoolError,
};

/// Permission bits are stored on the Position account
/// If the NFT is transferred and the new owner approves a new SPL delegate,
/// the new delegate will inherit whatever `delegate_permission` are currently set on the Position.
///
/// When granting the SPL delegate via `Approve`, it is required to set `amount = 0` to allow the
/// delegate to invoke other instructions on this position.
/// This also prevents the delegate from transferring/burning the position NFT via the SPL token program.
#[event_cpi]
#[derive(Accounts)]
pub struct UpdateDelegatePermissionCtx<'info> {
    #[account(mut)]
    pub position: AccountLoader<'info, Position>,

    /// The token account for nft
    #[account(
        constraint = position_nft_account.mint == position.load()?.nft_mint,
        constraint = position_nft_account.amount == 1,
        token::authority = owner,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub owner: Signer<'info>,
}

pub fn handle_update_delegate_permission(
    ctx: Context<UpdateDelegatePermissionCtx>,
    permission: u32,
) -> Result<()> {
    require!(
        permission < 1u32 << PositionDelegatePermission::VARIANT_COUNT,
        PoolError::InvalidPermission
    );

    let mut position = ctx.accounts.position.load_mut()?;
    position.set_delegate_permission(permission);

    emit_cpi!(EvtUpdateDelegatePermission {
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.owner.key(),
        permission,
        delegate: ctx.accounts.position_nft_account.delegate.into(),
    });

    Ok(())
}
