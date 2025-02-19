pub const FEE_CURVE_DURATION_NUMBER: usize = 6;

/// refer raydium clmm
pub const MIN_SQRT_PRICE: u128 = 4295048016;
/// refer raydium clmm
pub const MAX_SQRT_PRICE: u128 = 79226673521066979257578248091;

pub const LIQUIDITY_MAX: u128 = 34028236692093846346337460743;

pub const BASIS_POINT_MAX: u64 = 10_000;

pub const U24_MAX: u32 = 0xffffff;

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

    pub const FIVE_MINUTES_SLOT_BUFFER: u64 = SLOT_BUFFER / 12; // 5 minutes

    pub const FIVE_MINUTES_TIME_BUFFER: u64 = TIME_BUFFER / 12; // 5 minutes

    pub const MAX_FEE_CURVE_TIME_DURATION: u64 = 3600 * 24; // 1 day
    pub const MAX_FEE_CURVE_SLOT_DURATION: u64 = 9000 * 24; // 1 day

    pub const MAX_HIGH_TAX_TIME_DURATION: u64 = TIME_BUFFER / 6; // 10 minutes
    pub const MAX_HIGH_TAX_SLOT_DURATION: u64 = SLOT_BUFFER / 6; // 10 minutes
}

/// Store constants related to fees
pub mod fee {
    /// Host trade fee numerator
    // 20% of protocol trade fee
    pub const HOST_TRADE_FEE_NUMERATOR: u64 = 200_000;

    /// Default fee denominator. DO NOT simply update it as it will break logic that depends on it as default value.
    pub const FEE_DENOMINATOR: u64 = 1_000_000_000;

    /// Max fee BPS
    pub const MAX_FEE_BPS: u64 = 1500; // 15%
    pub const MAX_FEE_NUMERATOR: u64 = 150_000_000; // 15%

    /// Max basis point. 100% in pct
    pub const MAX_BASIS_POINT: u64 = 10000;

    // For meme coins
    pub const MEME_MIN_FEE_NUMERATOR: u64 = 2_500_000; // 250 / FEE_DENOMINATOR = 0.25%
    pub const MEME_CONFIG_START_MAX_FEE_NUMERATOR: u64 = 990_000_000; // 99_000 / FEE_DENOMINATOR = 99%

    pub const MEME_MIN_FEE_BPS: u64 = 25; // 0.25%
    pub const MEME_CONFIG_START_MAX_FEE_BPS: u64 = 9900; // 99%

    static_assertions::const_assert_eq!(
        MAX_FEE_BPS * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MAX_FEE_NUMERATOR
    );

    static_assertions::const_assert_eq!(
        MEME_CONFIG_START_MAX_FEE_BPS * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MEME_CONFIG_START_MAX_FEE_NUMERATOR
    );

    static_assertions::const_assert_eq!(
        MEME_MIN_FEE_BPS * FEE_DENOMINATOR / MAX_BASIS_POINT,
        MEME_MIN_FEE_NUMERATOR
    );

    pub const MEME_PROTOCOL_FEE_PERCENT: u8 = 20; // 20%

    pub const MEME_MIN_FEE_UPDATE_WINDOW_DURATION: i64 = 60 * 30; // 30 minutes

    // pub const MAX_PARTNER_FEE_NUMERATOR: u64 = 500_000; // 50%

    // static_assertions::const_assert!(MAX_PARTNER_FEE_NUMERATOR <= FEE_DENOMINATOR);
}

pub mod seeds {
    pub const CONFIG_PREFIX: &[u8] = b"config";
    pub const CUSTOMIZABLE_POOL_PREFIX: &[u8] = b"cpool";
    pub const POOL_PREFIX: &[u8] = b"pool";
    pub const TOKEN_VAULT_PREFIX: &[u8] = b"token_vault";
    pub const POOL_AUTHORITY_PREFIX: &[u8] = b"pool_authority";
    pub const POSITION_PREFIX: &[u8] = b"position";
    pub const TOKEN_BADGE_PREFIX: &[u8] = b"token_badge";
}
