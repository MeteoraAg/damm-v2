use anchor_lang::prelude::*;

use crate::{
    params::fee_parameters::DynamicFeeParameters,
    state::{Operator, OperatorPermission, Pool},
    EvtUpdatePoolFees, PoolError,
};

#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub struct UpdatePoolFeesParameters {
    /// Base fee update mode:
    /// - None: skip base fee update
    /// - Some: update new cliff_fee_numerator if base fee is static
    pub cliff_fee_numerator: Option<u64>,
    /// Dynamic fee update mode:
    /// - None: skip dynamic fee update
    /// - Some(with default value): disable dynamic fee
    /// - Some(with non default value): enable dynamic fee if disabled or update dynamic fee if enabled
    pub dynamic_fee: Option<DynamicFeeParameters>,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum DynamicFeeUpdateMode {
    Skip,
    Disable,
    Update,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BaseFeeUpdateMode {
    Skip,
    Update,
}

impl UpdatePoolFeesParameters {
    pub fn get_base_fee_update_mode(&self) -> BaseFeeUpdateMode {
        if self.cliff_fee_numerator.is_none() {
            BaseFeeUpdateMode::Skip
        } else {
            BaseFeeUpdateMode::Update
        }
    }

    pub fn get_dynamic_fee_update_mode(&self) -> DynamicFeeUpdateMode {
        if let Some(dynamic_fee) = self.dynamic_fee {
            if dynamic_fee == DynamicFeeParameters::default() {
                DynamicFeeUpdateMode::Disable
            } else {
                DynamicFeeUpdateMode::Update
            }
        } else {
            DynamicFeeUpdateMode::Skip
        }
    }
    fn validate(&self) -> Result<()> {
        // We don't need to validate `cliff_fee_numerator` in case we update it.
        // Because after update pool fee we will validate pool fee with new updated parameters
        require!(
            self.cliff_fee_numerator.is_some() || self.dynamic_fee.is_some(),
            PoolError::InvalidDynamicFeeParameters
        );

        if let Some(dynamic_fee) = self.dynamic_fee {
            if dynamic_fee != DynamicFeeParameters::default() {
                dynamic_fee.validate()?;
            }
        }

        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct UpdatePoolFeesCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        has_one = whitelisted_address
    )]
    pub operator: AccountLoader<'info, Operator>,

    pub whitelisted_address: Signer<'info>,
}

pub fn handle_update_pool_fees(
    ctx: Context<UpdatePoolFeesCtx>,
    params: UpdatePoolFeesParameters,
) -> Result<()> {
    params.validate()?;
    let operator = ctx.accounts.operator.load()?;
    require!(
        operator.is_permission_allow(OperatorPermission::UpdatePoolFees),
        PoolError::InvalidAuthority
    );

    let mut pool = ctx.accounts.pool.load_mut()?;

    pool.validate_and_update_pool_fees(&params)?;

    emit_cpi!(EvtUpdatePoolFees {
        pool: ctx.accounts.pool.key(),
        operator: ctx.accounts.whitelisted_address.key(),
        params,
    });

    Ok(())
}
