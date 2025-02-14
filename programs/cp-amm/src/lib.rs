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

declare_id!("3VcoGUqpWGa9a2GCCDM3osCH6bYoaNMoV9J1cpmQzSwD");

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

    /// Close config
    pub fn close_config(ctx: Context<CloseConfigCtx>) -> Result<()> {
        instructions::handle_close_config(ctx)
    }

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        params: InitializePoolParameters,
    ) -> Result<()> {
        Ok(())
        // instructions::handle_initialize_pool(ctx, params)
    }

    pub fn add_liquidity(ctx: Context<AddLiquidity>, params: AddLiquidityParameters) -> Result<()> {
        instructions::handle_add_liquidity(ctx, params)
    }
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        params: RemoveLiquidityParameters,
    ) -> Result<()> {
        instructions::handle_remove_liquidity(ctx, params)
    }

    pub fn create_position(ctx: Context<CreatePosition>) -> Result<()> {
        instructions::handle_create_position(ctx)
    }

    pub fn swap(ctx: Context<Swap>, params: SwapParameters) -> Result<()> {
        instructions::handle_swap(ctx, params)
    }
}
