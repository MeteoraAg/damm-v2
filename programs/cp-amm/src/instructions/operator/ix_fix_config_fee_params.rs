use anchor_lang::prelude::*;

use crate::activation_handler::ActivationType;
use crate::base_fee::BaseFeeEnumReader;
use crate::error::PoolError;
use crate::params::fee_parameters::BaseFeeParameters;
use crate::state::{CollectFeeMode, Config};
use crate::{base_fee::BaseFeeHandlerBuilder, state::Operator};

#[derive(Accounts)]
pub struct FixConfigFeeParams<'info> {
    #[account(mut)]
    pub config: AccountLoader<'info, Config>,

    pub operator: AccountLoader<'info, Operator>,

    pub signer: Signer<'info>,
}

pub fn handle_fix_config_fee_params(
    ctx: Context<FixConfigFeeParams>,
    params: BaseFeeParameters,
) -> Result<()> {
    let mut config = ctx.accounts.config.load_mut()?;

    let base_fee_handler = config.pool_fees.base_fee.get_base_fee_handler()?;

    let collect_fee_mode: CollectFeeMode = config
        .collect_fee_mode
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;

    let activation_type: ActivationType = config
        .activation_type
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;

    // Ensure it has invalid parameters and needs to be fixed
    let validation_result = base_fee_handler.validate(collect_fee_mode, activation_type);
    require!(validation_result.is_err(), PoolError::CannotUpdateBaseFee);

    let min_base_fee_numerator_0 = base_fee_handler.get_min_base_fee_numerator()?;
    let cliff_fee_numerator_0 = base_fee_handler.get_cliff_fee_numerator()?;
    let base_fee_mode_0 = config.pool_fees.base_fee.get_base_fee_mode()?;

    config.pool_fees.base_fee = params.to_base_fee_config()?;

    // Reload
    let base_fee_handler_after = config.pool_fees.base_fee.get_base_fee_handler()?;

    let min_base_fee_numerator_1 = base_fee_handler_after.get_min_base_fee_numerator()?;
    let cliff_fee_numerator_1 = base_fee_handler_after.get_cliff_fee_numerator()?;
    let base_fee_mode_1 = config.pool_fees.base_fee.get_base_fee_mode()?;

    require!(
        min_base_fee_numerator_0 == min_base_fee_numerator_1
            && base_fee_mode_0 == base_fee_mode_1
            && cliff_fee_numerator_0 == cliff_fee_numerator_1,
        PoolError::CannotUpdateBaseFee
    );

    // Ensure the new parameters are valid
    base_fee_handler_after.validate(collect_fee_mode, activation_type)?;

    Ok(())
}
