use anchor_lang::prelude::*;

use crate::{
    constants::seeds::POSITION_PREFIX,
    state::{Pool, Position},
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreatePositionCtx<'info> {
    /// CHECK: position owner
    pub owner: UncheckedAccount<'info>,

    /// Address paying to create the position. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    pub pool: AccountLoader<'info, Pool>,

    #[account(
        init,
        seeds = [
            POSITION_PREFIX.as_ref(),
            pool.key().as_ref(),
            owner.key().as_ref(),
        ],
        bump,
        payer = payer,
        space = 8 + Position::INIT_SPACE
    )]
    pub position: AccountLoader<'info, Position>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_position(ctx: Context<CreatePositionCtx>) -> Result<()> {
    // init position
    let mut position = ctx.accounts.position.load_init()?;

    position.initialize(
        ctx.accounts.pool.key(),
        ctx.accounts.owner.key(),
        Pubkey::default(), // TODO may add more params
        Pubkey::default(), // TODO may add more params
        0,
        0, // TODO check this
        0,
    );

    Ok(())
}
