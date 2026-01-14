#![allow(unexpected_cfgs)]
#![allow(deprecated)]
use anchor_lang::prelude::*;

#[macro_use]
pub mod macros;

pub mod const_pda;
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
pub mod base_fee;
pub mod math;
pub use math::*;
pub mod curve;

pub mod tests;

pub mod pool_action_access;
pub use pool_action_access::*;
pub mod access_control;
pub use access_control::*;
use params::fee_parameters::BaseFeeParameters;
use state::OperatorPermission;

#[cfg(not(feature = "no-custom-entrypoint"))]
mod entrypoint;
#[cfg(not(feature = "no-custom-entrypoint"))]
pub use entrypoint::entrypoint;

pub mod params;

declare_id!("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

// Only for IDL generation
#[cfg(feature = "idl-build")]
#[derive(Accounts)]
pub struct ForIdlTypeGenerationDoNotCallThis<'info> {
    pod_aligned_fee_time_scheduler:
        AccountLoader<'info, base_fee::fee_time_scheduler::PodAlignedFeeTimeScheduler>,
    pod_aligned_fee_rate_limiter:
        AccountLoader<'info, base_fee::fee_rate_limiter::PodAlignedFeeRateLimiter>,
    pod_aligned_fee_market_cap_scheduler:
        AccountLoader<'info, base_fee::fee_market_cap_scheduler::PodAlignedFeeMarketCapScheduler>,
}

#[cfg(feature = "idl-build")]
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DummyParams {
    borsh_fee_time_scheduler_params: base_fee::fee_time_scheduler::BorshFeeTimeScheduler,
    borsh_fee_rate_limiter_params: base_fee::fee_rate_limiter::BorshFeeRateLimiter,
    borsh_fee_market_cap_scheduler_params:
        base_fee::fee_market_cap_scheduler::BorshFeeMarketCapScheduler,
}

#[program]
pub mod cp_amm {

    use super::*;

    /// ADMIN FUNCTIONS /////
    #[access_control(is_admin(ctx.accounts.signer.key))]
    pub fn create_operator_account(
        ctx: Context<CreateOperatorAccountCtx>,
        permission: u128,
    ) -> Result<()> {
        instructions::handle_create_operator(ctx, permission)
    }

    #[access_control(is_admin(ctx.accounts.signer.key))]
    pub fn close_operator_account(ctx: Context<CloseOperatorAccountCtx>) -> Result<()> {
        Ok(())
    }

    /// OPERATOR FUNCTIONS /////
    // create static config
    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::CreateConfigKey))]
    pub fn create_config(
        ctx: Context<CreateConfigCtx>,
        index: u64,
        config_parameters: StaticConfigParameters,
    ) -> Result<()> {
        instructions::handle_create_static_config(ctx, index, config_parameters)
    }

    // create static config
    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::CreateConfigKey))]
    pub fn create_dynamic_config(
        ctx: Context<CreateConfigCtx>,
        index: u64,
        config_parameters: DynamicConfigParameters,
    ) -> Result<()> {
        instructions::handle_create_dynamic_config(ctx, index, config_parameters)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::CreateTokenBadge))]
    pub fn create_token_badge(ctx: Context<CreateTokenBadgeCtx>) -> Result<()> {
        instructions::handle_create_token_badge(ctx)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::RemoveConfigKey))]
    pub fn close_config(ctx: Context<CloseConfigCtx>) -> Result<()> {
        instructions::handle_close_config(ctx)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::UpdatePoolFees))]
    pub fn fix_pool_fee_params(
        ctx: Context<FixPoolFeeParams>,
        params: BaseFeeParameters,
    ) -> Result<()> {
        instructions::handle_fix_pool_fee_params(ctx, params)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::UpdatePoolFees))]
    pub fn fix_config_fee_params(
        ctx: Context<FixConfigFeeParams>,
        params: BaseFeeParameters,
    ) -> Result<()> {
        instructions::handle_fix_config_fee_params(ctx, params)
    }

    pub fn initialize_reward<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeRewardCtx<'info>>,
        reward_index: u8,
        reward_duration: u64,
        funder: Pubkey,
    ) -> Result<()> {
        instructions::handle_initialize_reward(ctx, reward_index, reward_duration, funder)
    }

    pub fn fund_reward(
        ctx: Context<FundRewardCtx>,
        reward_index: u8,
        amount: u64,
        carry_forward: bool,
    ) -> Result<()> {
        instructions::handle_fund_reward(ctx, reward_index, amount, carry_forward)
    }

    pub fn withdraw_ineligible_reward(
        ctx: Context<WithdrawIneligibleRewardCtx>,
        reward_index: u8,
    ) -> Result<()> {
        instructions::handle_withdraw_ineligible_reward(ctx, reward_index)
    }

    pub fn update_reward_funder<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateRewardFunderCtx<'info>>,
        reward_index: u8,
        new_funder: Pubkey,
    ) -> Result<()> {
        instructions::handle_update_reward_funder(ctx, reward_index, new_funder)
    }

    pub fn update_reward_duration<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, UpdateRewardDurationCtx<'info>>,
        reward_index: u8,
        new_duration: u64,
    ) -> Result<()> {
        instructions::handle_update_reward_duration(ctx, reward_index, new_duration)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::SetPoolStatus))]
    pub fn set_pool_status(ctx: Context<SetPoolStatusCtx>, status: u8) -> Result<()> {
        instructions::handle_set_pool_status(ctx, status)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::ClaimProtocolFee))]
    pub fn claim_protocol_fee(
        ctx: Context<ClaimProtocolFeesCtx>,
        max_amount_a: u64,
        max_amount_b: u64,
    ) -> Result<()> {
        instructions::handle_claim_protocol_fee(ctx, max_amount_a, max_amount_b)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::ZapProtocolFee))]
    pub fn zap_protocol_fee(ctx: Context<ZapProtocolFee>, max_amount: u64) -> Result<()> {
        instructions::handle_zap_protocol_fee(ctx, max_amount)
    }

    #[deprecated = "We currently disable this, and could enable this in the future"]
    pub fn claim_partner_fee(
        ctx: Context<ClaimPartnerFeesCtx>,
        max_amount_a: u64,
        max_amount_b: u64,
    ) -> Result<()> {
        instructions::handle_claim_partner_fee(ctx, max_amount_a, max_amount_b)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::CloseTokenBadge))]
    pub fn close_token_badge(ctx: Context<CloseTokenBadgeCtx>) -> Result<()> {
        instructions::handle_close_token_badge(ctx)
    }

    #[access_control(is_valid_operator_role(&ctx.accounts.operator, ctx.accounts.signer.key, OperatorPermission::UpdatePoolFees))]
    pub fn update_pool_fees(
        ctx: Context<UpdatePoolFeesCtx>,
        params: UpdatePoolFeesParameters,
    ) -> Result<()> {
        instructions::handle_update_pool_fees(ctx, params)
    }

    /// USER FUNCTIONS ////

    pub fn initialize_pool<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializePoolCtx<'info>>,
        params: InitializePoolParameters,
    ) -> Result<()> {
        instructions::handle_initialize_pool(ctx, params)
    }

    pub fn initialize_pool_with_dynamic_config<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializePoolWithDynamicConfigCtx<'info>>,
        params: InitializeCustomizablePoolParameters,
    ) -> Result<()> {
        instructions::handle_initialize_pool_with_dynamic_config(ctx, params)
    }

    pub fn initialize_customizable_pool<'c: 'info, 'info>(
        ctx: Context<'_, '_, 'c, 'info, InitializeCustomizablePoolCtx<'info>>,
        params: InitializeCustomizablePoolParameters,
    ) -> Result<()> {
        instructions::handle_initialize_customizable_pool(ctx, params)
    }

    pub fn create_position(ctx: Context<CreatePositionCtx>) -> Result<()> {
        instructions::handle_create_position(ctx)
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
        instructions::handle_remove_liquidity(
            ctx,
            Some(params.liquidity_delta),
            params.token_a_amount_threshold,
            params.token_b_amount_threshold,
        )
    }

    pub fn remove_all_liquidity(
        ctx: Context<RemoveLiquidityCtx>,
        token_a_amount_threshold: u64,
        token_b_amount_threshold: u64,
    ) -> Result<()> {
        instructions::handle_remove_liquidity(
            ctx,
            None,
            token_a_amount_threshold,
            token_b_amount_threshold,
        )
    }

    pub fn close_position(ctx: Context<ClosePositionCtx>) -> Result<()> {
        instructions::handle_close_position(ctx)
    }

    pub fn swap(_ctx: Context<SwapCtx>, _params: SwapParameters) -> Result<()> {
        Ok(())
        // instructions::swap::handle_swap_wrapper(
        //     &ctx,
        //     SwapParameters2 {
        //         amount_0: params.amount_in,
        //         amount_1: params.minimum_amount_out,
        //         swap_mode: SwapMode::ExactIn.into(),
        //     },
        // )
    }

    pub fn swap2(_ctx: Context<SwapCtx>, _params: SwapParameters2) -> Result<()> {
        Ok(())
        // instructions::swap::handle_swap_wrapper(&ctx, params)
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

    pub fn claim_reward(
        ctx: Context<ClaimRewardCtx>,
        reward_index: u8,
        skip_reward: u8,
    ) -> Result<()> {
        instructions::handle_claim_reward(ctx, reward_index, skip_reward)
    }

    pub fn split_position(
        ctx: Context<SplitPositionCtx>,
        params: SplitPositionParameters,
    ) -> Result<()> {
        instructions::handle_split_position2(ctx, params.get_split_position_parameters2()?)
    }

    pub fn split_position2(ctx: Context<SplitPositionCtx>, numerator: u32) -> Result<()> {
        instructions::handle_split_position2(
            ctx,
            SplitPositionParameters2 {
                unlocked_liquidity_numerator: numerator,
                permanent_locked_liquidity_numerator: numerator,
                fee_a_numerator: numerator,
                fee_b_numerator: numerator,
                reward_0_numerator: numerator,
                reward_1_numerator: numerator,
            },
        )
    }

    #[cfg(feature = "idl-build")]
    pub fn dummy_ix(
        _ctx: Context<ForIdlTypeGenerationDoNotCallThis>,
        _ixs: DummyParams,
    ) -> Result<()> {
        Ok(())
    }
}
