use anchor_lang::prelude::*;

use crate::activation_handler::ActivationType;
use crate::base_fee::BaseFeeEnumReader;
use crate::error::PoolError;
use crate::params::fee_parameters::BaseFeeParameters;
use crate::state::CollectFeeMode;
use crate::{
    activation_handler::ActivationHandler,
    base_fee::BaseFeeHandlerBuilder,
    state::{Operator, Pool},
};

#[derive(Accounts)]
pub struct FixPoolFeeParams<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_fix_pool_fee_params(
    ctx: Context<FixPoolFeeParams>,
    params: BaseFeeParameters,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let base_fee_handler = pool
        .pool_fees
        .base_fee
        .base_fee_info
        .get_base_fee_handler()?;

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    let collect_fee_mode: CollectFeeMode = pool
        .collect_fee_mode
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;

    let activation_type: ActivationType = pool
        .activation_type
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;

    // Ensure that it's already over the scheduler time window
    require!(
        base_fee_handler.validate_base_fee_is_static(current_point, pool.activation_point)?,
        PoolError::CannotUpdateBaseFee
    );

    // Ensure it has invalid parameters and needs to be fixed
    let validation_result = base_fee_handler.validate(collect_fee_mode, activation_type);
    require!(validation_result.is_err(), PoolError::CannotUpdateBaseFee);

    let fee_numerator_0 = base_fee_handler.get_min_base_fee_numerator()?;
    let base_fee_mode_0 = pool.pool_fees.base_fee.base_fee_info.get_base_fee_mode()?;

    pool.pool_fees.base_fee = params.to_base_fee_struct()?;

    // Reload
    let base_fee_handler_after = pool
        .pool_fees
        .base_fee
        .base_fee_info
        .get_base_fee_handler()?;

    let fee_numerator_1 = base_fee_handler_after.get_min_base_fee_numerator()?;
    let base_fee_mode_1 = pool.pool_fees.base_fee.base_fee_info.get_base_fee_mode()?;

    require!(
        fee_numerator_0 == fee_numerator_1 && base_fee_mode_0 == base_fee_mode_1,
        PoolError::CannotUpdateBaseFee
    );

    // Ensure the new parameters are valid
    base_fee_handler_after.validate(collect_fee_mode, activation_type)?;

    Ok(())
}
