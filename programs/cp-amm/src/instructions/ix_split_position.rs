use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::seeds::POOL_AUTHORITY_PREFIX,
    get_pool_access_validator,
    state::{Pool, Position},
    EvtSplitPosition, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct SplitPositionCtx<'info> {
    /// CHECK: pool authority
    #[account(seeds = [POOL_AUTHORITY_PREFIX.as_ref()], bump)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    /// The token account for nft
    #[account(
        mut,
        constraint = position_nft_account.mint == position.load()?.nft_mint,
        constraint = position_nft_account.amount == 1,
        token::authority = owner
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        has_one = pool
    )]
    pub position: AccountLoader<'info, Position>,

    #[account(
        constraint = new_position_nft_account.mint == new_position.load()?.nft_mint,
        constraint = new_position_nft_account.amount == 1,
        token::authority = new_position_owner
)]
    pub new_position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        has_one = pool,
      )]
    pub new_position: AccountLoader<'info, Position>,

    /// CHECK: owner of new position
    pub new_position_owner: UncheckedAccount<'info>,

    /// Owner of position
    pub owner: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_split_position(ctx: Context<SplitPositionCtx>, liquidity_delta: u128) -> Result<()> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_remove_liquidity(),
            PoolError::PoolDisabled
        );
    }

    let mut pool = ctx.accounts.pool.load_mut()?;

    let mut position = ctx.accounts.position.load_mut()?;
    let mut new_position = ctx.accounts.new_position.load_mut()?;

    require!(new_position.is_empty()?, PoolError::PositionIsNotEmpty);

    // update current pool reward & postion reward before any logic
    let current_time = Clock::get()?.unix_timestamp as u64;
    position.update_rewards(&mut pool, current_time)?;

    require!(
        liquidity_delta <= position.unlocked_liquidity && liquidity_delta > 0,
        PoolError::InsufficientLiquidity
    );

    // remove liquidity delta from position
    pool.apply_remove_liquidity(&mut position, liquidity_delta)?;

    //  add liquidity delta to new position
    pool.apply_add_liquidity(&mut new_position, liquidity_delta)?;

    emit_cpi!(EvtSplitPosition {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.owner.key(),
        new_position_owner: ctx.accounts.new_position_owner.key(),
        position: ctx.accounts.position.key(),
        new_position: ctx.accounts.new_position.key(),
        liquidity_delta,
    });

    Ok(())
}
