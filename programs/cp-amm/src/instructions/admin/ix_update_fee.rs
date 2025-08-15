use anchor_lang::prelude::*;

use crate::{
    activation_handler::ActivationHandler,
    assert_eq_admin,
    params::fee_parameters::BaseFeeParameters,
    safe_math::SafeMath,
    state::{fee::BaseFeeMode, Pool},
    EvtUpdateFee, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateFeeCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

pub fn handle_update_fee(ctx: Context<UpdateFeeCtx>, new_cliff_fee_numerator: u64) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let activation_type = pool.activation_type;
    let activation_point = pool.activation_point;
    let collect_fee_mode = pool.collect_fee_mode;

    let base_fee = &mut pool.pool_fees.base_fee;
    let period_frequency = u64::from_le_bytes(base_fee.second_factor);
    let base_fee_mode =
        BaseFeeMode::try_from(base_fee.base_fee_mode).map_err(|_| PoolError::InvalidBaseFeeMode)?;

    if period_frequency != 0 && base_fee_mode != BaseFeeMode::RateLimiter {
        let number_of_period = base_fee.first_factor;
        let period_frequency = u64::from_le_bytes(base_fee.second_factor);

        let current_point = ActivationHandler::get_current_point(activation_type)?;

        require!(
            current_point >= activation_point,
            PoolError::UnableToUpdateFeeDuringFeeSchedule
        );

        let period: u16 = current_point
            .safe_sub(activation_point)?
            .safe_div(period_frequency)?
            .try_into()
            .map_err(|_| PoolError::MathOverflow)?;

        require!(
            period >= number_of_period,
            PoolError::UnableToUpdateFeeDuringFeeSchedule
        );
    }

    let base_fee_params = BaseFeeParameters {
        cliff_fee_numerator: new_cliff_fee_numerator,
        first_factor: base_fee.first_factor,
        second_factor: base_fee.second_factor,
        third_factor: base_fee.third_factor,
        base_fee_mode: base_fee.base_fee_mode,
    };

    base_fee_params.validate(
        collect_fee_mode
            .try_into()
            .map_err(|_| PoolError::InvalidActivationType)?,
        activation_type
            .try_into()
            .map_err(|_| PoolError::InvalidCollectFeeMode)?,
    )?;

    base_fee.cliff_fee_numerator = new_cliff_fee_numerator;

    emit_cpi!(EvtUpdateFee {
        pool: ctx.accounts.pool.key(),
        admin: ctx.accounts.admin.key(),
        new_cliff_fee_numerator,
    });

    Ok(())
}
