use anchor_lang::constant;

pub const MIN_SQRT_PRICE: u128 = 4295048016;

#[cfg(feature = "idl-build")]
#[constant]
pub const MIN_SQRT_PRICE_LE_BYTES: [u8; 16] = MIN_SQRT_PRICE.to_le_bytes();

pub const MAX_SQRT_PRICE: u128 = 79226673521066979257578248091;

#[cfg(feature = "idl-build")]
#[constant]
pub const MAX_SQRT_PRICE_LE_BYTES: [u8; 16] = MAX_SQRT_PRICE.to_le_bytes();

pub const LIQUIDITY_SCALE: u8 = 128;

pub const REWARD_RATE_SCALE: u8 = 64;

pub const TOTAL_REWARD_SCALE: u8 = 192;

pub const ONE_Q64: u128 = 1u128 << 64;

#[constant]
pub const BIN_STEP_BPS_DEFAULT: u16 = 1;

//  bin_step << 64 / MAX_BASIS_POINT
pub const BIN_STEP_BPS_U128_DEFAULT: u128 = 1844674407370955;

#[cfg(feature = "idl-build")]
#[constant]
pub const BIN_STEP_U128_DEFAULT_LE_BYTES: [u8; 16] = BIN_STEP_BPS_U128_DEFAULT.to_le_bytes();

static_assertions::const_assert_eq!(LIQUIDITY_SCALE + REWARD_RATE_SCALE, TOTAL_REWARD_SCALE);

pub const U24_MAX: u32 = 0xffffff;

// Number of bits to scale. This will decide the position of the radix point.

// Number of rewards supported by pool
pub const NUM_REWARDS: usize = 2;
pub const REWARD_INDEX_0: usize = 0;
pub const REWARD_INDEX_1: usize = 1;

// Minimum reward duration
pub const MIN_REWARD_DURATION: u64 = 24 * 60 * 60; // 1 day

pub const MAX_REWARD_DURATION: u64 = 31536000; // 1 year = 365 * 24 * 3600

// need to export as constant in case someone want to calculate split position numerator
#[constant]
pub const SPLIT_POSITION_DENOMINATOR: u32 = 1_000_000_000; // 1b

pub const MAX_RATE_LIMITER_DURATION_IN_SECONDS: u32 = 60 * 60 * 12; // 12 hours
pub const MAX_RATE_LIMITER_DURATION_IN_SLOTS: u32 = 108000; // 12 hours

pub const MAX_OPERATION: u8 = 11;

static_assertions::const_assert_eq!(
    MAX_RATE_LIMITER_DURATION_IN_SECONDS * 1000 / 400,
    MAX_RATE_LIMITER_DURATION_IN_SLOTS
);

pub mod activation {
    #[cfg(not(feature = "local"))]
    pub const SLOT_BUFFER: u64 = 9000; // 1 slot = 400 mls => 1 hour
    #[cfg(feature = "local")]
    pub const SLOT_BUFFER: u64 = 5;

    #[cfg(not(feature = "local"))]
    pub const TIME_BUFFER: u64 = 3600; // 1 hour
    #[cfg(feature = "local")]
    pub const TIME_BUFFER: u64 = 5; // 5 secs

    #[cfg(not(feature = "local"))]
    pub const MAX_ACTIVATION_SLOT_DURATION: u64 = SLOT_BUFFER * 24 * 31; // 31 days
    #[cfg(feature = "local")]
    pub const MAX_ACTIVATION_SLOT_DURATION: u64 = 30;

    #[cfg(not(feature = "local"))]
    pub const MAX_ACTIVATION_TIME_DURATION: u64 = TIME_BUFFER * 24 * 31; // 31 days
    #[cfg(feature = "local")]
    pub const MAX_ACTIVATION_TIME_DURATION: u64 = 30;

    pub const MAX_VESTING_SLOT_DURATION: u64 = SLOT_BUFFER * 24 * 365 * 10; // 10 years
    pub const MAX_VESTING_TIME_DURATION: u64 = TIME_BUFFER * 24 * 365 * 10; // 10 years

    pub const FIVE_MINUTES_SLOT_BUFFER: u64 = SLOT_BUFFER / 12; // 5 minutes

    pub const FIVE_MINUTES_TIME_BUFFER: u64 = TIME_BUFFER / 12; // 5 minutes

    pub const MAX_FEE_CURVE_TIME_DURATION: u64 = 3600 * 24; // 1 day
    pub const MAX_FEE_CURVE_SLOT_DURATION: u64 = 9000 * 24; // 1 day

    pub const MAX_HIGH_TAX_TIME_DURATION: u64 = TIME_BUFFER / 6; // 10 minutes
    pub const MAX_HIGH_TAX_SLOT_DURATION: u64 = SLOT_BUFFER / 6; // 10 minutes
}

/// Store constants related to fees
pub mod fee {
    use crate::PoolError;
    use anchor_lang::prelude::*;

    /// Default fee denominator. DO NOT simply update it as it will break logic that depends on it as default value.
    #[constant]
    pub const FEE_DENOMINATOR: u64 = 1_000_000_000;

    /// Max fee BPS
    pub const MAX_FEE_BPS_V0: u64 = 5000; // 50%
    pub const MAX_FEE_NUMERATOR_V0: u64 = 500_000_000; // 50%

    pub const MAX_FEE_BPS_V1: u64 = 9900; // 99%
    pub const MAX_FEE_NUMERATOR_V1: u64 = 990_000_000; // 99%

    /// Max basis point. 100% in pct
    #[constant]
    pub const MAX_BASIS_POINT: u64 = 10_000;

    pub const MIN_FEE_BPS: u64 = 1; // 0.01%
    pub const MIN_FEE_NUMERATOR: u64 = 100_000;

    pub const MAX_FEE_NUMERATOR_POST_UPDATE: u64 = 100_000_000; // 10%

    static_assertions::const_assert_eq!(
        MAX_FEE_BPS_V0 * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MAX_FEE_NUMERATOR_V0
    );

    static_assertions::const_assert_eq!(
        MAX_FEE_BPS_V1 * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MAX_FEE_NUMERATOR_V1
    );

    static_assertions::const_assert_eq!(
        MIN_FEE_BPS * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MIN_FEE_NUMERATOR
    );

    pub const PROTOCOL_FEE_PERCENT: u8 = 20; // 20%

    pub const HOST_FEE_PERCENT: u8 = 20; // 20% of protocol fee

    pub const PARTNER_FEE_PERCENT: u8 = 0; // percentage of partner fee

    static_assertions::const_assert!(PROTOCOL_FEE_PERCENT <= 50);
    static_assertions::const_assert!(HOST_FEE_PERCENT <= 50);
    static_assertions::const_assert!(PARTNER_FEE_PERCENT <= 50);

    pub const CURRENT_POOL_VERSION: u8 = 1;

    pub fn get_max_fee_numerator(pool_version: u8) -> Result<u64> {
        match pool_version {
            0 => Ok(MAX_FEE_NUMERATOR_V0),
            1 => Ok(MAX_FEE_NUMERATOR_V1),
            _ => Err(PoolError::InvalidPoolVersion.into()),
        }
    }

    pub fn get_max_fee_bps(pool_version: u8) -> Result<u64> {
        match pool_version {
            0 => Ok(MAX_FEE_BPS_V0),
            1 => Ok(MAX_FEE_BPS_V1),
            _ => Err(PoolError::InvalidPoolVersion.into()),
        }
    }
}

pub mod seeds {
    use anchor_lang::constant;

    pub const CONFIG_PREFIX: &[u8] = b"config";

    #[constant]
    pub const CUSTOMIZABLE_POOL_PREFIX: &[u8] = b"cpool";

    #[constant]
    pub const POOL_PREFIX: &[u8] = b"pool";

    #[constant]
    pub const TOKEN_VAULT_PREFIX: &[u8] = b"token_vault";

    #[constant]
    pub const POOL_AUTHORITY_PREFIX: &[u8] = b"pool_authority";

    #[constant]
    pub const POSITION_PREFIX: &[u8] = b"position";

    #[constant]
    pub const POSITION_NFT_ACCOUNT_PREFIX: &[u8] = b"position_nft_account";
    pub const TOKEN_BADGE_PREFIX: &[u8] = b"token_badge";
    pub const REWARD_VAULT_PREFIX: &[u8] = b"reward_vault";
    pub const CLAIM_FEE_OPERATOR_PREFIX: &[u8] = b"cf_operator";
    pub const OPERATOR_PREFIX: &[u8] = b"operator";
}

pub mod treasury {
    use anchor_lang::{prelude::Pubkey, solana_program::pubkey};
    // https://app.squads.so/squads/4EWqcx3aNZmMetCnxwLYwyNjan6XLGp3Ca2W316vrSjv/treasury
    pub const ID: Pubkey = pubkey!("4EWqcx3aNZmMetCnxwLYwyNjan6XLGp3Ca2W316vrSjv");
}
