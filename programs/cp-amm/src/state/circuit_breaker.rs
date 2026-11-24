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

/// Global circuit breaker, stored in the event authority ([crate::EVENT_AUTHORITY_AND_BUMP]).
/// User endpoints with `#[event_cpi]` always check it. `refresh_vesting` and `claim_protocol_fee2`
/// check it only when the event authority and the program are passed as their first two remaining
/// accounts, the event authority first. Endpoints that only an admin or an operator can call don't
/// check it. Endpoints that both the pool creator or operator can call, such as
/// `initialize_reward`, do check it.
#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct CircuitBreaker {
    /// Bitmask of disabled [ActionGroup]s, a set bit disables the group. Zero enables everything
    pub disabled_actions: u64,
    /// Starts at the slot in which `initialize_circuit_breaker` ran, and is incremented by every
    /// `set_circuit_breaker`. `set_circuit_breaker` and `close_circuit_breaker` must pass the
    /// current nonce, so a transaction built before any other update fails, even if the bitmask
    /// went back to the value it was built from.
    ///
    /// Limitation: closing the circuit breaker and initializing it again doesn't always invalidate
    /// transactions built for the old one. The new nonce starts at the slot of the new
    /// initialization. If the old circuit breaker had at least as many updates as there were slots
    /// between the two initializations, its nonce reached that slot, so an old transaction can
    /// still apply to the new one. This is unlikely in practice, because the operator would need to
    /// average at least one update per slot for the whole life of the old circuit
    /// breaker.
    ///
    /// Limitation: `initialize_circuit_breaker` does not take a nonce, so a signed initialization that
    /// hasn't executed yet can still execute after a close and set its `disabled_actions`.
    ///
    /// A client that doesn't know the slot `initialize_circuit_breaker` will run in can't put
    /// `set_circuit_breaker` after it in the same transaction. Every later nonce is
    /// predictable, so several updates can run in one transaction, and an update can be signed in
    /// advance for a future nonce
    pub nonce: u64,
    pub padding: [u64; 6],
}

const_assert_eq!(CircuitBreaker::INIT_SPACE, 64);

impl CircuitBreaker {
    pub fn is_action_enabled(&self, action: ActionGroup) -> bool {
        self.disabled_actions & (1u64 << Into::<u8>::into(action)) == 0
    }
}
