use crate::error::PoolError;
use crate::state::Position;
use crate::EvtTransferPosition;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct TransferPosition<'info> {
    #[account(mut, has_one = owner)]
    pub position: AccountLoader<'info, Position>,
    pub owner: Signer<'info>,
}

pub fn handle_transfer_position(ctx: Context<TransferPosition>, new_owner: Pubkey) -> Result<()> {
    require!(
        ctx.accounts.owner.key() != new_owner,
        PoolError::InvalidPositionOwner
    );

    let mut position = ctx.accounts.position.load_mut()?;
    position.owner = new_owner;

    emit_cpi!(EvtTransferPosition {
        position: ctx.accounts.position.key(),
        owner: ctx.accounts.owner.key(),
        new_owner,
        pool: position.pool
    });

    Ok(())
}
