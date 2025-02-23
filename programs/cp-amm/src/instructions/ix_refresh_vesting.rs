use anchor_lang::prelude::*;
use std::cell::RefMut;
use std::collections::BTreeSet;

use crate::{
    activation_handler::ActivationHandler,
    state::{Pool, Position, Vesting},
    PoolError,
};

#[derive(Accounts)]
pub struct RefreshVesting<'info> {
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        mut,
        has_one = pool,
        has_one = owner,
    )]
    pub position: AccountLoader<'info, Position>,

    /// CHECK: Permissionless
    pub owner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct VestingRemainingAccount<'info> {
    #[account(mut)]
    pub vesting: AccountLoader<'info, Vesting>,
}

impl<'info> VestingRemainingAccount<'info> {
    pub fn load_and_validate(&self, position: Pubkey) -> Result<RefMut<'_, Vesting>> {
        let vesting = self.vesting.load_mut()?;
        require!(
            vesting.position == position,
            PoolError::InvalidVestingAccount
        );
        Ok(vesting)
    }
}

pub fn handle_refresh_vesting<'a, 'b, 'c: 'info, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, RefreshVesting<'info>>,
) -> Result<()> {
    let pool = ctx.accounts.pool.load()?;

    let (current_point, _) =
        ActivationHandler::get_current_point_and_buffer_duration(pool.activation_type)?;

    let mut position: RefMut<'_, Position> = ctx.accounts.position.load_mut()?;
    let mut remaining_accounts = &ctx.remaining_accounts[..];

    loop {
        if remaining_accounts.is_empty() {
            break;
        }

        let vesting_account = VestingRemainingAccount::try_accounts(
            &crate::ID,
            &mut remaining_accounts,
            &[],
            &mut VestingRemainingAccountBumps {},
            &mut BTreeSet::new(),
        )?;

        let mut vesting = vesting_account.load_and_validate(ctx.accounts.position.key())?;
        release_vesting_liquidity_to_position(&mut vesting, &mut position, current_point)?;

        if vesting.done()? {
            drop(vesting);
            vesting_account
                .vesting
                .close(ctx.accounts.owner.to_account_info())?;
        }
    }

    Ok(())
}

fn release_vesting_liquidity_to_position(
    vesting: &mut RefMut<'_, Vesting>,
    position: &mut RefMut<'_, Position>,
    current_point: u64,
) -> Result<()> {
    let released_liquidity = vesting.get_new_release_liquidity(current_point)?;
    if released_liquidity > 0 {
        position.release_vested_liquidity(released_liquidity)?;
        vesting.accumulate_released_liquidity(released_liquidity)?;
    }

    Ok(())
}
