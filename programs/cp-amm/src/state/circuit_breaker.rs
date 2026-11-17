use anchor_lang::prelude::*;
use derive_variant_count::VariantCount;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use static_assertions::const_assert_eq;

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
    VariantCount,
)]
pub enum ActionGroup {
    /// `swap`, `swap2`
    Swap,
    /// `create_position`, `add_liquidity`
    AddLiquidity,
    /// `remove_liquidity`, `remove_all_liquidity`
    RemoveLiquidity,
    /// `claim_position_fee`, `claim_protocol_fee2`
    ClaimFee,
    /// `claim_reward`, `withdraw_ineligible_reward`, `withdraw_dead_liquidity_reward`
    ClaimReward,
    /// `close_position`, `lock_position`, `lock_inner_position`, `permanent_lock_position`,
    /// `refresh_vesting`, `split_position`, `split_position2`, `update_delegate_permission`
    PositionManagement,
    /// `initialize_reward`, `fund_reward`, `update_reward_funder`, `update_reward_duration`
    RewardManagement,
    /// `initialize_pool`, `initialize_pool_with_dynamic_config`, `initialize_customizable_pool`
    CreatePool,
}

/// Global circuit breaker, stored in the pool authority
/// Endpoints that only an admin or an operator can call don't check it.
/// Endpoints that both the pool creator or operator can call, such as `initialize_reward`, do check it.
#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct CircuitBreaker {
    /// Bitmask of disabled ActionGroup. Zero enables everything
    pub disabled_actions: u64,
    /// Incremented by every `set_circuit_breaker`.
    pub nonce: u64,
    pub padding: [u64; 6],
}

const_assert_eq!(CircuitBreaker::INIT_SPACE, 64);

impl CircuitBreaker {
    pub fn is_action_enabled(&self, action: ActionGroup) -> bool {
        self.disabled_actions & (1u64 << Into::<u8>::into(action)) == 0
    }
}
