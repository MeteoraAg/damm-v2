use anchor_lang::prelude::*;

#[macro_use]
pub mod macros;

pub mod instructions;
pub use instructions::*;
pub mod constants;
pub mod error;
pub mod state;
pub use error::*;
pub mod event;
pub use event::*;
pub mod utils;
pub use utils::*;
pub mod math;
pub use math::*;
pub mod curve;
pub mod tests;

pub mod params;

#[cfg(feature = "local")]
declare_id!("9sh3gorJVsWgpdJo317PqnoWoTuDN2LkxiyYUUTu4sNJ");

#[cfg(not(feature = "local"))]
declare_id!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

#[program]
pub mod cp_amm {
    use super::*;

    /// Create config
    pub fn create_config(
        ctx: Context<CreateConfigCtx>,
        config_parameters: ConfigParameters,
    ) -> Result<()> {
        instructions::handle_create_config(ctx, config_parameters)
    }

    /// Create token badge
    pub fn create_token_badge(ctx: Context<CreateTokenBadgeCtx>) -> Result<()> {
        instructions::handle_create_token_badge(ctx)
    }

    /// Close config
    pub fn close_config(ctx: Context<CloseConfigCtx>) -> Result<()> {
        instructions::handle_close_config(ctx)
    }

    pub fn initialize_pool<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializePoolCtx<'info>>,
        params: InitializePoolParameters,
    ) -> Result<()> {
        instructions::handle_initialize_pool(ctx, params)
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidityCtx>,
        params: AddLiquidityParameters,
    ) -> Result<()> {
        instructions::handle_add_liquidity(ctx, params)
    }
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidityCtx>,
        params: RemoveLiquidityParameters,
    ) -> Result<()> {
        instructions::handle_remove_liquidity(ctx, params)
    }

    pub fn create_position(ctx: Context<CreatePositionCtx>) -> Result<()> {
        instructions::handle_create_position(ctx)
    }

    pub fn swap(ctx: Context<SwapCtx>, params: SwapParameters) -> Result<()> {
        instructions::handle_swap(ctx, params)
    }

    pub fn claim_position_fee(ctx: Context<ClaimPositionFeeCtx>) -> Result<()> {
        instructions::handle_claim_position_fee(ctx)
    }

    pub fn lock_position(ctx: Context<LockPositionCtx>, params: VestingParameters) -> Result<()> {
        instructions::handle_lock_position(ctx, params)
    }

    pub fn refresh_vesting<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, RefreshVesting<'info>>,
    ) -> Result<()> {
        instructions::handle_refresh_vesting(ctx)
    }

    pub fn permanent_lock_position(
        ctx: Context<PermanentLockPositionCtx>,
        permanent_lock_liquidity: u128,
    ) -> Result<()> {
        instructions::handle_permanent_lock_position(ctx, permanent_lock_liquidity)
    }
}
