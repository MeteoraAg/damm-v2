use crate::activation_handler::ActivationHandler;
use crate::constants::fee::MAX_BASIS_POINT;
use crate::error::PoolError;
use crate::safe_math::SafeMath;
use crate::state::{Pool, Position};
use crate::EvtLockPosition;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct VestingParameters {
    // Set cliff point to u64::MAX as permanent lock
    pub cliff_point: Option<u64>,
    pub period_frequency: u64,
    pub cliff_unlock_bps: u16,
    pub unlock_bps_per_period: u16,
    pub number_of_period: u16,
}

impl VestingParameters {
    pub fn get_cliff_point(&self, current_point: u64) -> Result<u64> {
        Ok(self.cliff_point.unwrap_or(current_point.safe_add(1)?))
    }

    pub fn validate(&self, current_point: u64) -> Result<()> {
        let cliff_point = self.get_cliff_point(current_point)?;

        require!(cliff_point > current_point, PoolError::InvalidVestingInfo);

        let max_basis_point = MAX_BASIS_POINT as u16;
        let total_bps = self
            .cliff_unlock_bps
            .safe_add(self.unlock_bps_per_period.safe_mul(self.number_of_period)?)?;

        require!(total_bps == max_basis_point, PoolError::InvalidVestingInfo);

        if self.number_of_period > 0 {
            require!(self.period_frequency > 0, PoolError::InvalidVestingInfo);
        }

        // Block potential overflow
        cliff_point.safe_add(
            self.period_frequency
                .safe_mul(self.number_of_period.into())?,
        )?;

        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct LockPosition<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut, has_one = pool, has_one = owner)]
    pub position: AccountLoader<'info, Position>,

    pub owner: Signer<'info>,
}

pub fn handle_lock_position(ctx: Context<LockPosition>, params: VestingParameters) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;
    let (current_point, _) =
        ActivationHandler::get_current_point_and_buffer_duration(pool.activation_type)?;

    params.validate(current_point)?;

    let mut position = ctx.accounts.position.load_mut()?;
    require!(position.liquidity > 0, PoolError::AmountIsZero);
    // Add liquidity before lock position
    require!(
        !position.is_locked(current_point)?,
        PoolError::PositionAlreadyLocked
    );

    let VestingParameters {
        period_frequency,
        cliff_unlock_bps,
        unlock_bps_per_period,
        number_of_period,
        ..
    } = params;

    let cliff_point = params.get_cliff_point(current_point)?;

    position.lock(
        cliff_point,
        period_frequency,
        cliff_unlock_bps,
        unlock_bps_per_period,
        number_of_period,
    );

    pool.update_permanent_locked_liquidity(&position)?;

    emit_cpi!(EvtLockPosition {
        position: ctx.accounts.position.key(),
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.owner.key(),
        cliff_point,
        period_frequency,
        cliff_unlock_bps,
        unlock_bps_per_period,
        number_of_period,
    });

    Ok(())
}
