use crate::constants::activation::*;
use crate::params::pool_fees::{DynamicFeeParameters, PartnerInfo, PoolFeeParamters};
use crate::safe_math::SafeMath;
use crate::PoolError;
use crate::{activation_handler::ActivationType, alpha_vault::alpha_vault};
use anchor_lang::prelude::*;

use super::fee::{DynamicFeeStruct, PoolFeesStruct};

#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct PoolFeesConfig {
    pub trade_fee_numerator: u64,
    pub protocol_fee_percent: u8,
    pub partner_fee_percent: u8,
    pub referral_fee_percent: u8,
    pub padding_0: [u8; 5],
    /// dynamic fee
    pub dynamic_fee: DynamicFeeConfig,
    pub padding_1: [u64; 2],
}
impl PoolFeesConfig {
    pub fn from_pool_fee_parameters(pool_fees: &PoolFeeParamters) -> Self {
        let &PoolFeeParamters {
            trade_fee_numerator,
            protocol_fee_percent,
            partner_fee_percent,
            referral_fee_percent,
            dynamic_fee,
        } = pool_fees;
        if let Some(DynamicFeeParameters {
            bin_step,
            bin_step_u128,
            filter_period,
            decay_period,
            reduction_factor,
            max_volatility_accumulator,
            variable_fee_control,
        }) = dynamic_fee
        {
            Self {
                trade_fee_numerator,
                protocol_fee_percent,
                partner_fee_percent,
                referral_fee_percent,
                dynamic_fee: DynamicFeeConfig {
                    initialized: 1,
                    bin_step,
                    filter_period,
                    decay_period,
                    reduction_factor,
                    bin_step_u128,
                    max_volatility_accumulator,
                    variable_fee_control,
                    ..Default::default()
                },
                ..Default::default()
            }
        } else {
            Self {
                trade_fee_numerator,
                protocol_fee_percent,
                partner_fee_percent,
                referral_fee_percent,
                ..Default::default()
            }
        }
    }

    pub fn to_pool_fee_parameters(&self) -> PoolFeeParamters {
        let &PoolFeesConfig {
            trade_fee_numerator,
            protocol_fee_percent,
            partner_fee_percent,
            referral_fee_percent,
            dynamic_fee:
                DynamicFeeConfig {
                    initialized,
                    bin_step,
                    bin_step_u128,
                    filter_period,
                    decay_period,
                    reduction_factor,
                    max_volatility_accumulator,
                    variable_fee_control,
                    ..
                },
            ..
        } = self;
        if initialized == 1 {
            PoolFeeParamters {
                trade_fee_numerator,
                protocol_fee_percent,
                partner_fee_percent,
                referral_fee_percent,
                dynamic_fee: Some(DynamicFeeParameters {
                    bin_step,
                    bin_step_u128,
                    filter_period,
                    decay_period,
                    reduction_factor,
                    max_volatility_accumulator,
                    variable_fee_control,
                }),
            }
        } else {
            PoolFeeParamters {
                trade_fee_numerator,
                protocol_fee_percent,
                partner_fee_percent,
                referral_fee_percent,
                ..Default::default()
            }
        }
    }

    pub fn to_pool_fees_struct(&self) -> PoolFeesStruct {
        let &PoolFeesConfig {
            trade_fee_numerator,
            protocol_fee_percent,
            partner_fee_percent,
            referral_fee_percent,
            dynamic_fee:
                DynamicFeeConfig {
                    initialized,
                    bin_step,
                    bin_step_u128,
                    filter_period,
                    decay_period,
                    reduction_factor,
                    max_volatility_accumulator,
                    variable_fee_control,
                    ..
                },
            ..
        } = self;

        if initialized == 1 {
            PoolFeesStruct {
                trade_fee_numerator,
                protocol_fee_percent,
                partner_fee_percent,
                referral_fee_percent,
                dynamic_fee: DynamicFeeStruct {
                    initialized: 1,
                    bin_step,
                    filter_period,
                    decay_period,
                    reduction_factor,
                    bin_step_u128,
                    max_volatility_accumulator,
                    variable_fee_control,
                    ..Default::default()
                },
                ..Default::default()
            }
        } else {
            PoolFeesStruct {
                trade_fee_numerator,
                protocol_fee_percent,
                partner_fee_percent,
                referral_fee_percent,
                ..Default::default()
            }
        }
    }
}
#[zero_copy]
#[derive(Debug, InitSpace, Default)]
pub struct DynamicFeeConfig {
    pub initialized: u8, // 0, ignore for dynamic fee
    pub padding: [u8; 7],
    pub max_volatility_accumulator: u32,
    pub variable_fee_control: u32,
    pub bin_step: u16,
    pub filter_period: u16,
    pub decay_period: u16,
    pub reduction_factor: u16,
    pub bin_step_u128: u128,
}

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// Vault config key
    pub vault_config_key: Pubkey,
    /// Only pool_creator_authority can use the current config to initialize new pool. When it's Pubkey::default, it's a public config.
    pub pool_creator_authority: Pubkey,
    /// Pool fee
    pub pool_fees: PoolFeesConfig,
    /// Activation type
    pub activation_type: u8,
    /// Collect fee mode
    pub collect_fee_mode: u8,
    /// padding 0
    pub _padding_0: [u8; 6],
    /// config index
    pub index: u64,
    /// sqrt min price
    pub sqrt_min_price: u128,
    /// sqrt max price
    pub sqrt_max_price: u128,
    /// Fee curve point
    /// Padding for further use
    pub _padding_1: [u64; 10],
}

pub struct BootstrappingConfig {
    pub activation_point: u64,
    pub vault_config_key: Pubkey,
    pub activation_type: u8,
}

pub struct TimingConstraint {
    pub current_point: u64,
    pub min_activation_duration: u64,
    pub max_activation_duration: u64,
    pub pre_activation_swap_duration: u64,
    pub last_join_buffer: u64,
    pub max_fee_curve_duration: u64,
    pub max_high_tax_duration: u64,
}

impl TimingConstraint {
    pub fn get_max_activation_point_from_current_time(&self) -> Result<u64> {
        Ok(self.current_point.safe_add(self.max_activation_duration)?)
    }
}

pub fn get_timing_constraint_by_activation_type(
    activation_type: ActivationType,
    clock: &Clock,
) -> TimingConstraint {
    match activation_type {
        ActivationType::Slot => TimingConstraint {
            current_point: clock.slot,
            min_activation_duration: SLOT_BUFFER,
            max_activation_duration: MAX_ACTIVATION_SLOT_DURATION,
            pre_activation_swap_duration: SLOT_BUFFER,
            last_join_buffer: FIVE_MINUTES_SLOT_BUFFER,
            max_fee_curve_duration: MAX_FEE_CURVE_SLOT_DURATION,
            max_high_tax_duration: MAX_HIGH_TAX_SLOT_DURATION,
        },
        ActivationType::Timestamp => TimingConstraint {
            current_point: clock.unix_timestamp as u64,
            min_activation_duration: TIME_BUFFER,
            max_activation_duration: MAX_ACTIVATION_TIME_DURATION,
            pre_activation_swap_duration: TIME_BUFFER,
            last_join_buffer: FIVE_MINUTES_TIME_BUFFER,
            max_fee_curve_duration: MAX_FEE_CURVE_TIME_DURATION,
            max_high_tax_duration: MAX_HIGH_TAX_TIME_DURATION,
        },
    }
}

impl Config {
    pub fn init(
        &mut self,
        index: u64,
        pool_fees: &PoolFeeParamters,
        vault_config_key: Pubkey,
        pool_creator_authority: Pubkey,
        activation_type: u8,
        sqrt_min_price: u128,
        sqrt_max_price: u128,
        collect_fee_mode: u8,
    ) {
        self.index = index;
        self.pool_fees = PoolFeesConfig::from_pool_fee_parameters(pool_fees);
        self.vault_config_key = vault_config_key;
        self.pool_creator_authority = pool_creator_authority;
        self.activation_type = activation_type;
        self.sqrt_min_price = sqrt_min_price;
        self.sqrt_max_price = sqrt_max_price;
        self.collect_fee_mode = collect_fee_mode;
    }

    pub fn to_bootstrapping_config(&self, activation_point: u64) -> BootstrappingConfig {
        BootstrappingConfig {
            activation_point,
            vault_config_key: self.vault_config_key,
            activation_type: self.activation_type,
        }
    }

    pub fn get_partner_info(&self) -> PartnerInfo {
        PartnerInfo {
            partner_authority: self.pool_creator_authority,
            fee_percent: self.pool_fees.partner_fee_percent,
            ..Default::default()
        }
    }

    pub fn has_alpha_vault(&self) -> bool {
        self.vault_config_key.ne(&Pubkey::default())
    }

    pub fn get_whitelisted_alpha_vault(&self, pool: Pubkey) -> Pubkey {
        if self.vault_config_key.eq(&Pubkey::default()) {
            Pubkey::default()
        } else {
            alpha_vault::derive_vault_pubkey(self.vault_config_key, pool.key())
        }
    }

    pub fn get_max_activation_point_from_current_time(&self, clock: &Clock) -> Result<u64> {
        let timing_contraints = get_timing_constraint_by_activation_type(
            self.activation_type
                .try_into()
                .map_err(|_| PoolError::InvalidActivationType)?,
            clock,
        );
        timing_contraints.get_max_activation_point_from_current_time()
    }
}
