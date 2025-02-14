use crate::activation_handler::ActivationType;
use crate::assert_eq_admin;
use crate::constants::fee::{ FEE_DENOMINATOR, MEME_MIN_FEE_NUMERATOR };
use crate::params::pool_fees::validate_fee_fraction;
use crate::state::config::Config;
use crate::state::CollectFeeMode;
use crate::PoolError;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateConfigCtx<'info> {
    #[account(mut)]
    pub config: AccountLoader<'info, Config>,

    #[account(constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

pub fn handle_update_pool_fee(ctx: Context<UpdateConfigCtx>, param: u8, value: u64) -> Result<()> {
    let mut config_state = ctx.accounts.config.load_mut()?;
    match Some(param) {
        Some(0) => update_trade_fee_numerator(&mut config_state, value)?,
        Some(1) => update_protocol_fee_percent(&mut config_state, value as u8)?,
        Some(2) => update_partner_fee_percent(&mut config_state, value as u8)?,
        Some(3) => update_referral_fee_percent(&mut config_state, value as u8)?,
        _ => {
            return Err(PoolError::InvalidInput.into());
        }
    }
    Ok(())
}

// TODO update dynamic fee

pub fn handle_update_config(ctx: Context<UpdateConfigCtx>, param: u8, value: u8) -> Result<()> {
    let mut config_state = ctx.accounts.config.load_mut()?;
    match Some(param) {
        Some(0) => update_activation_type(&mut config_state, value)?,
        Some(1) => update_collect_fee_mode(&mut config_state, value)?,
        _ => {
            return Err(PoolError::InvalidInput.into());
        }
    }
    Ok(())
}

fn update_activation_type(config_state: &mut Config, activation_type: u8) -> Result<()> {
    // validate type
    require!(ActivationType::try_from(activation_type).is_ok(), PoolError::InvalidActivationType);

    config_state.activation_type = activation_type;

    Ok(())
}

fn update_collect_fee_mode(config_state: &mut Config, mode: u8) -> Result<()> {
    // validate mode
    require!(CollectFeeMode::try_from(mode).is_ok(), PoolError::InvalidCollectFeeMode);

    config_state.collect_fee_mode = mode;

    Ok(())
}

fn update_trade_fee_numerator(config_state: &mut Config, value: u64) -> Result<()> {
    // validate new numerator
    require!(value % MEME_MIN_FEE_NUMERATOR == 0, PoolError::InvalidFee); // avoid odd number
    require!(value < FEE_DENOMINATOR, PoolError::InvalidFee);

    config_state.pool_fees.trade_fee_numerator = value;

    Ok(())
}

fn update_protocol_fee_percent(config_state: &mut Config, value: u8) -> Result<()> {
    // validate value
    validate_fee_fraction(value.into(), 100)?;

    config_state.pool_fees.protocol_fee_percent = value;
    Ok(())
}

fn update_partner_fee_percent(config_state: &mut Config, value: u8) -> Result<()> {
    // validate value
    validate_fee_fraction(value.into(), 100)?;

    config_state.pool_fees.partner_fee_percent = value;

    Ok(())
}

fn update_referral_fee_percent(config_state: &mut Config, value: u8) -> Result<()> {
    // validate value
    validate_fee_fraction(value.into(), 100)?;

    config_state.pool_fees.referral_fee_percent = value;
    Ok(())
}
