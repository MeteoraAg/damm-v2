use anchor_lang::prelude::*;

use crate::{
    assert_eq_admin, base_fee::get_base_fee_handler, state::Pool, EvtUpdateFee, PoolError,
};

#[derive(Accounts)]
pub struct UpdateFeeCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

pub fn handle_update_fee(ctx: Context<UpdateFeeCtx>, new_cliff_fee_numerator: u64) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    pool.validate_to_update_fee()?;

    let collect_fee_mode = pool
        .collect_fee_mode
        .try_into()
        .map_err(|_| PoolError::InvalidActivationType)?;
    let activation_type = pool
        .activation_type
        .try_into()
        .map_err(|_| PoolError::InvalidCollectFeeMode)?;

    let base_fee = &mut pool.pool_fees.base_fee;

    let base_fee_handler = get_base_fee_handler(
        new_cliff_fee_numerator,
        base_fee.first_factor,
        base_fee.second_factor,
        base_fee.third_factor,
        base_fee.base_fee_mode,
    )?;
    base_fee_handler.validate(collect_fee_mode, activation_type)?;

    let old_cliff_fee_numerator = base_fee.cliff_fee_numerator;
    base_fee.cliff_fee_numerator = new_cliff_fee_numerator;

    emit!(EvtUpdateFee {
        pool: ctx.accounts.pool.key(),
        old_cliff_fee_numerator,
        new_cliff_fee_numerator,
    });

    Ok(())
}
