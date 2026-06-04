use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::MAX_POSITION_DELEGATE_PERMISSION, state::Position, EvtSetDelegatePermission,
    PoolError,
};

/// Set the delegate permission bitmask on a position. This instruction only manages the
/// permission bits stored on the Position account. The caller is responsible for
/// managing the SPL token delegate on the position NFT (via SPL token program
/// `Approve` / `Revoke`) separately — typically composed in the same transaction.
///
/// Passing `permission = 0` clears all permissions; the caller should pair this with
/// an SPL `Revoke` if they also want to remove the SPL delegate.
///
/// Permission bits are stored on the Position account.
/// If the  NFT is transferred and the new owner approves a new SPL delegate, the new delegate
/// will inherit whatever `delegate_permission` bits are currently set on the Position.
/// New owners should call `set_delegate_permission(0)` before granting access to a new
/// delegate.
#[event_cpi]
#[derive(Accounts)]
pub struct SetDelegatePermissionCtx<'info> {
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

pub fn handle_set_delegate_permission(
    ctx: Context<SetDelegatePermissionCtx>,
    permission: u128,
) -> Result<()> {
    require!(
        permission < 1u128 << MAX_POSITION_DELEGATE_PERMISSION,
        PoolError::InvalidPermission
    );

    let mut position = ctx.accounts.position.load_mut()?;
    position.set_delegate_permission(permission);

    emit_cpi!(EvtSetDelegatePermission {
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.owner.key(),
        permission,
    });

    Ok(())
}
