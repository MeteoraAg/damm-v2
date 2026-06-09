use crate::{
    activation_handler::ActivationHandler,
    error::PoolError,
    state::{Pool, Position, PositionDelegatePermission},
    EvtLockPosition, LockPositionInfo,
};
use crate::{process_initialize_inner_vesting, VestingParameters};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: VestingParameters)]
pub struct LockInnerPositionCtx<'info> {
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut, has_one = pool)]
    pub position: AccountLoader<'info, Position>,

    /// The token account for nft
    #[account(
        constraint = position_nft_account.mint == position.load()?.nft_mint,
        constraint = position_nft_account.amount == 1,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Signer
    pub signer: Signer<'info>,
}

pub fn handle_lock_inner_position(
    ctx: Context<LockInnerPositionCtx>,
    params: VestingParameters,
) -> Result<()> {
    let mut position = ctx.accounts.position.load_mut()?;

    position.assert_authority(
        &ctx.accounts.position_nft_account,
        &ctx.accounts.signer.key(),
        PositionDelegatePermission::LockPosition,
    )?;

    let pool = ctx.accounts.pool.load()?;
    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;
    // refresh inner vesting firstly to retrieve the latest state of unlocked liquidity
    position.refresh_inner_vesting(current_point)?;

    require!(
        position.inner_vesting.is_empty(),
        PoolError::InvalidVestingAccount
    );

    let LockPositionInfo {
        total_lock_liquidity,
        cliff_point,
    } = process_initialize_inner_vesting(&params, &ctx.accounts.pool, &mut position.inner_vesting)?;

    position.lock(total_lock_liquidity)?;

    emit_cpi!(EvtLockPosition {
        position: ctx.accounts.position.key(),
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.position_nft_account.owner,
        vesting: ctx.accounts.position.key(),
        cliff_point,
        period_frequency: params.period_frequency,
        cliff_unlock_liquidity: params.cliff_unlock_liquidity,
        liquidity_per_period: params.liquidity_per_period,
        number_of_period: params.number_of_period,
    });

    Ok(())
}
