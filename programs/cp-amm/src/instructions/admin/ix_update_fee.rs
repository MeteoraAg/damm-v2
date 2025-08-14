use anchor_lang::prelude::*;

use crate::{
    activation_handler::ActivationType,
    assert_eq_admin, get_pool_access_validator,
    params::fee_parameters::BaseFeeParameters,
    state::{CollectFeeMode, Pool},
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

    // Validate pool state
    {
        let access_validator = get_pool_access_validator(&pool)?;

        require!(
            access_validator.can_update_fee(),
            PoolError::UnableToUpdateFeeBeforeActivationPoint
        );
    }

    // Validate the new cliff_fee_numerator
    {
        let activation_type = ActivationType::try_from(pool.activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let collect_fee_mode = CollectFeeMode::try_from(pool.collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        let base_fee_params = BaseFeeParameters {
            cliff_fee_numerator: new_cliff_fee_numerator,
            first_factor: pool.pool_fees.base_fee.first_factor,
            second_factor: pool.pool_fees.base_fee.second_factor,
            third_factor: pool.pool_fees.base_fee.third_factor,
            base_fee_mode: pool.pool_fees.base_fee.base_fee_mode,
        };

        base_fee_params.validate(collect_fee_mode, activation_type)?;
    }

    pool.pool_fees.base_fee.cliff_fee_numerator = new_cliff_fee_numerator;

    emit_cpi!(EvtUpdateFee {
        pool: ctx.accounts.pool.key(),
        admin: ctx.accounts.admin.key(),
        new_cliff_fee_numerator,
    });

    Ok(())
}
