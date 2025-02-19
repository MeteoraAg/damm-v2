use crate::constants::activation::*;
use crate::params::pool_fees::{PartnerInfo, PoolFees};
use crate::{activation_handler::ActivationType, alpha_vault::alpha_vault};
use anchor_lang::prelude::*;

use super::fee::PoolFeesStruct;

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
pub struct Config {
    /// Vault config key
    pub vault_config_key: Pubkey,
    /// Only pool_creator_authority can use the current config to initialize new pool. When it's Pubkey::default, it's a public config.
    pub pool_creator_authority: Pubkey,
    /// Pool fee
    pub pool_fees: PoolFeesStruct,
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
        pool_fees: &PoolFees,
        vault_config_key: Pubkey,
        pool_creator_authority: Pubkey,
        activation_type: u8,
        sqrt_min_price: u128,
        sqrt_max_price: u128,
        collect_fee_mode: u8,
    ) {
        self.index = index;
        self.pool_fees = PoolFeesStruct::from_pool_fees(pool_fees);
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

    pub fn get_whitelisted_alpha_vault(&self, pool: Pubkey) -> Pubkey {
        if self.vault_config_key.eq(&Pubkey::default()) {
            Pubkey::default()
        } else {
            alpha_vault::derive_vault_pubkey(self.vault_config_key, pool.key())
        }
    }
}
