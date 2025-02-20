use anchor_lang::prelude::*;

use crate::{
    constants::seeds::POSITION_PREFIX,
    get_pool_access_validator,
    state::{Pool, Position},
    EvtCreatePosition, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreatePositionCtx<'info> {
    /// CHECK: position owner
    pub owner: UncheckedAccount<'info>,

    /// Address paying to create the position. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
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
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_create_position(),
            PoolError::PoolDisabled
        );
    }

    // init position
    let mut position = ctx.accounts.position.load_init()?;
    let mut pool = ctx.accounts.pool.load_mut()?;

    let liquidity = 0;

    position.initialize(
        &mut pool,
        ctx.accounts.pool.key(),
        ctx.accounts.owner.key(),
        liquidity,
    )?;

    emit_cpi!(EvtCreatePosition {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.owner.key(),
        liquidity,
    });

    Ok(())
}
