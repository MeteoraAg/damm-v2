//! Error module includes error messages and codes of the program
use anchor_lang::prelude::*;

/// Error messages and codes of the program
#[error_code]
#[derive(PartialEq)]
pub enum PoolError {
    #[msg("Math operation overflow")]
    MathOverflow,

    #[msg("Invalid fee setup")]
    InvalidFee,

    #[msg("Exceeded slippage tolerance")]
    ExceededSlippage,

    #[msg("Pool disabled")]
    PoolDisabled,

    #[msg("Exceeded max fee bps")]
    ExceedMaxFeeBps,

    #[msg("Invalid admin")]
    InvalidAdmin,

    #[msg("Amount is zero")]
    AmountIsZero,

    #[msg("Type cast error")]
    TypeCastFailed,

    /// deprecated
    #[msg("Unable to modify activation point")]
    UnableToModifyActivationPoint,

    #[msg("Invalid authority to create the pool")]
    InvalidAuthorityToCreateThePool,

    #[msg("Invalid activation type")]
    InvalidActivationType,

    #[msg("Invalid activation point")]
    InvalidActivationPoint,

    /// deprecated
    #[msg("Quote token must be SOL,USDC")]
    InvalidQuoteMint,

    /// deprecated
    #[msg("Invalid fee curve")]
    InvalidFeeCurve,

    #[msg("Invalid Price Range")]
    InvalidPriceRange,

    #[msg("Trade is over price range")]
    PriceRangeViolation,

    #[msg("Invalid parameters")]
    InvalidParameters,

    #[msg("Invalid collect fee mode")]
    InvalidCollectFeeMode,

    #[msg("Invalid input")]
    InvalidInput,

    #[msg("Cannot create token badge on supported mint")]
    CannotCreateTokenBadgeOnSupportedMint,

    #[msg("Invalid token badge")]
    InvalidTokenBadge,

    #[msg("Invalid minimum liquidity")]
    InvalidMinimumLiquidity,

    #[msg("Invalid vesting information")]
    InvalidVestingInfo,

    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,

    #[msg("Invalid vesting account")]
    InvalidVestingAccount,

    #[msg("Invalid pool status")]
    InvalidPoolStatus,

    #[msg("Unsupported native mint token2022")]
    UnsupportNativeMintToken2022,

    #[msg("Invalid reward index")]
    InvalidRewardIndex,

    #[msg("Invalid reward duration")]
    InvalidRewardDuration,

    #[msg("Reward already initialized")]
    RewardInitialized,

    #[msg("Reward not initialized")]
    RewardUninitialized,

    #[msg("Invalid reward vault")]
    InvalidRewardVault,

    #[msg("Must withdraw ineligible reward")]
    MustWithdrawnIneligibleReward,

    #[msg("Reward duration is the same")]
    IdenticalRewardDuration,

    #[msg("Reward campaign in progress")]
    RewardCampaignInProgress,

    #[msg("Identical funder")]
    IdenticalFunder,

    #[msg("Invalid funder")]
    InvalidFunder,

    #[msg("Reward not ended")]
    RewardNotEnded,

    #[msg("Fee inverse is incorrect")]
    FeeInverseIsIncorrect,

    #[msg("Position is not empty")]
    PositionIsNotEmpty,

    #[msg("Invalid pool creator authority")]
    InvalidPoolCreatorAuthority,

    #[msg("Invalid config type")]
    InvalidConfigType,

    /// deprecated
    #[msg("Invalid pool creator")]
    InvalidPoolCreator,

    #[msg("Reward vault is frozen, must skip reward to proceed")]
    RewardVaultFrozenSkipRequired,

    #[msg("Invalid parameters for split position")]
    InvalidSplitPositionParameters,

    #[msg("Unsupported split position has vesting lock")]
    UnsupportPositionHasVestingLock,

    #[msg("Same position")]
    SamePosition,

    #[msg("Invalid base fee mode")]
    InvalidBaseFeeMode,

    #[msg("Invalid fee rate limiter")]
    InvalidFeeRateLimiter,

    #[msg("Fail to validate single swap instruction in rate limiter")]
    FailToValidateSingleSwapInstruction,

    #[msg("Invalid fee scheduler")]
    InvalidFeeTimeScheduler,

    #[msg("Undetermined error")]
    UndeterminedError,

    #[msg("Invalid pool version")]
    InvalidPoolVersion,

    #[msg("Invalid authority to do that action")]
    InvalidAuthority,

    #[msg("Invalid permission")]
    InvalidPermission,

    #[msg("Invalid fee market cap scheduler")]
    InvalidFeeMarketCapScheduler,

    #[msg("Cannot update base fee")]
    CannotUpdateBaseFee,

    #[msg("Invalid dynamic fee parameters")]
    InvalidDynamicFeeParameters,

    #[msg("Invalid update pool fees parameters")]
    InvalidUpdatePoolFeesParameters,

    #[msg("Missing operator account")]
    MissingOperatorAccount,

    #[msg("Incorrect ATA")]
    IncorrectATA,

    /// deprecated
    #[msg("Invalid zap out parameters")]
    InvalidZapOutParameters,

    /// deprecated
    #[msg("Invalid withdraw protocol fee zap accounts")]
    InvalidWithdrawProtocolFeeZapAccounts,

    /// deprecated
    #[msg("SOL,USDC protocol fee cannot be withdrawn via zap")]
    MintRestrictedFromZap,

    /// deprecated
    #[msg("CPI disabled")]
    CpiDisabled,

    /// deprecated
    #[msg("Missing zap out instruction")]
    MissingZapOutInstruction,

    /// deprecated
    #[msg("Invalid zap accounts")]
    InvalidZapAccounts,

    #[msg("Invalid compounding fee bps")]
    InvalidCompoundingFeeBps,

    #[msg("Invalid claim protocol fee accounts")]
    InvalidClaimProtocolFeeAccounts,

    #[msg("Transfer fee excluded amount is zero")]
    TransferFeeExcludedAmountIsZero,

    #[msg("Delegated amount is not zero")]
    DelegatedAmountNonZero,

    #[msg("Deprecated base fee mode")]
    DeprecatedBaseFeeMode,

    #[msg("Invalid remaining account slice")]
    InvalidRemainingAccountSlice,

    #[msg("Insufficient remaining accounts")]
    InsufficientRemainingAccounts,

    #[msg("Duplicated remaining account types")]
    DuplicatedRemainingAccountTypes,

    #[msg("Missing remaining account for transfer hook")]
    MissingRemainingAccountForTransferHook,

    #[msg("No transfer hook program")]
    NoTransferHookProgram,

    #[msg("Invalid remaining accounts length")]
    InvalidRemainingAccountsLength,
}

impl From<PoolError> for pinocchio::program_error::ProgramError {
    fn from(error: PoolError) -> Self {
        pinocchio::program_error::ProgramError::Custom(
            error as u32 + anchor_lang::error::ERROR_CODE_OFFSET,
        )
    }
}
