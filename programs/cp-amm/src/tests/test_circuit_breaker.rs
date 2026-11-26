use crate::{
    state::{ActionGroup, CircuitBreaker},
    strip_leading_event_cpi_accounts,
};
use anchor_lang::prelude::{AccountInfo, Pubkey};

const ALL_ACTION_GROUPS: [ActionGroup; ActionGroup::VARIANT_COUNT] = [
    ActionGroup::Swap,
    ActionGroup::AddLiquidity,
    ActionGroup::RemoveLiquidity,
    ActionGroup::ClaimFee,
    ActionGroup::ClaimReward,
    ActionGroup::PositionManagement,
    ActionGroup::RewardManagement,
    ActionGroup::CreatePool,
];

#[test]
fn test_is_action_enabled() {
    let circuit_breaker = CircuitBreaker::default();
    for action in ALL_ACTION_GROUPS {
        assert!(circuit_breaker.is_action_enabled(action));
    }

    for disabled in ALL_ACTION_GROUPS {
        let circuit_breaker = CircuitBreaker {
            disabled_actions: 1u64 << Into::<u8>::into(disabled),
            ..Default::default()
        };
        for action in ALL_ACTION_GROUPS {
            assert_eq!(
                circuit_breaker.is_action_enabled(action),
                action != disabled
            );
        }
    }

    let circuit_breaker = CircuitBreaker {
        disabled_actions: u64::MAX,
        ..Default::default()
    };
    for action in ALL_ACTION_GROUPS {
        assert!(!circuit_breaker.is_action_enabled(action));
    }
}

// The bit of a group is stored in the on-chain bitmask, so it must never change
#[test]
fn test_action_group_bits_are_stable() {
    assert_eq!(ActionGroup::Swap as u8, 0);
    assert_eq!(ActionGroup::AddLiquidity as u8, 1);
    assert_eq!(ActionGroup::RemoveLiquidity as u8, 2);
    assert_eq!(ActionGroup::ClaimFee as u8, 3);
    assert_eq!(ActionGroup::ClaimReward as u8, 4);
    assert_eq!(ActionGroup::PositionManagement as u8, 5);
    assert_eq!(ActionGroup::RewardManagement as u8, 6);
    assert_eq!(ActionGroup::CreatePool as u8, 7);
    assert_eq!(ActionGroup::VARIANT_COUNT, 8);
}

/// How an endpoint of `lib.rs` is expected to check the circuit breaker
#[derive(Debug, PartialEq)]
enum Check {
    /// `check_circuit_breaker` on the `event_authority` account of the endpoint
    EventAuthority(&'static str),
    /// `check_optional_circuit_breaker` on the first two remaining accounts
    LeadingRemainingAccounts(&'static str),
    /// `swap` and `swap2` never reach `lib.rs`: the entrypoint sends them to `p_handle_swap`
    InPinocchioSwap,
    /// Endpoints that only an admin or an operator can call are never disabled
    Never,
}

const EXPECTED_CHECKS: &[(&str, Check)] = &[
    ("create_operator_account", Check::Never),
    ("close_operator_account", Check::Never),
    ("create_config", Check::Never),
    ("create_dynamic_config", Check::Never),
    ("create_token_badge", Check::Never),
    ("close_config", Check::Never),
    ("fix_pool_fee_params", Check::Never),
    ("set_pool_status", Check::Never),
    ("close_token_badge", Check::Never),
    ("update_pool_fees", Check::Never),
    ("zero_pool_rate_limiter", Check::Never),
    ("initialize_circuit_breaker", Check::Never),
    ("close_circuit_breaker", Check::Never),
    ("dummy_ix", Check::Never),
    ("swap", Check::InPinocchioSwap),
    ("swap2", Check::InPinocchioSwap),
    ("create_position", Check::EventAuthority("AddLiquidity")),
    ("add_liquidity", Check::EventAuthority("AddLiquidity")),
    ("remove_liquidity", Check::EventAuthority("RemoveLiquidity")),
    (
        "remove_all_liquidity",
        Check::EventAuthority("RemoveLiquidity"),
    ),
    ("claim_position_fee", Check::EventAuthority("ClaimFee")),
    (
        "claim_protocol_fee2",
        Check::LeadingRemainingAccounts("ClaimFee"),
    ),
    ("claim_reward", Check::EventAuthority("ClaimReward")),
    (
        "withdraw_ineligible_reward",
        Check::EventAuthority("ClaimReward"),
    ),
    (
        "withdraw_dead_liquidity_reward",
        Check::EventAuthority("ClaimReward"),
    ),
    (
        "close_position",
        Check::EventAuthority("PositionManagement"),
    ),
    ("lock_position", Check::EventAuthority("PositionManagement")),
    (
        "lock_inner_position",
        Check::EventAuthority("PositionManagement"),
    ),
    (
        "permanent_lock_position",
        Check::EventAuthority("PositionManagement"),
    ),
    (
        "refresh_vesting",
        Check::LeadingRemainingAccounts("PositionManagement"),
    ),
    (
        "split_position",
        Check::EventAuthority("PositionManagement"),
    ),
    (
        "split_position2",
        Check::EventAuthority("PositionManagement"),
    ),
    (
        "update_delegate_permission",
        Check::EventAuthority("PositionManagement"),
    ),
    (
        "initialize_reward",
        Check::EventAuthority("RewardManagement"),
    ),
    ("fund_reward", Check::EventAuthority("RewardManagement")),
    (
        "update_reward_funder",
        Check::EventAuthority("RewardManagement"),
    ),
    (
        "update_reward_duration",
        Check::EventAuthority("RewardManagement"),
    ),
    ("initialize_pool", Check::EventAuthority("CreatePool")),
    (
        "initialize_pool_with_dynamic_config",
        Check::EventAuthority("CreatePool"),
    ),
    (
        "initialize_customizable_pool",
        Check::EventAuthority("CreatePool"),
    ),
];

fn program_endpoints() -> Vec<(String, String)> {
    let source = include_str!("../lib.rs");
    let program = &source[source
        .find("#[program")
        .expect("lib.rs has a #[program] module")..];

    let mut endpoints = vec![];
    let mut attributes = String::new();
    for line in program.lines() {
        if let Some(signature) = line.strip_prefix("    pub fn ") {
            let name: String = signature
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            endpoints.push((name, std::mem::take(&mut attributes)));
        } else if line.trim_start().starts_with("#[") {
            attributes.push_str(line.trim());
        } else {
            attributes.clear();
        }
    }
    endpoints
}

// Fails when an endpoint is added to `lib.rs` without deciding how it checks the circuit breaker,
// or when the check of an existing endpoint is removed or moved to another group
#[test]
fn test_every_endpoint_checks_circuit_breaker() {
    let endpoints = program_endpoints();
    assert_eq!(
        endpoints.len(),
        EXPECTED_CHECKS.len(),
        "an endpoint was added to or removed from lib.rs, update EXPECTED_CHECKS"
    );

    for (name, attributes) in endpoints {
        let (_, expected) = EXPECTED_CHECKS
            .iter()
            .find(|(expected_name, _)| *expected_name == name)
            .unwrap_or_else(|| panic!("{name} is missing from EXPECTED_CHECKS"));

        let check = if let Some((_, rest)) =
            attributes.split_once("check_circuit_breaker(&ctx.accounts.event_authority, ")
        {
            Some(("event_authority", rest))
        } else {
            attributes
                .split_once("check_optional_circuit_breaker(ctx.remaining_accounts, ")
                .map(|(_, rest)| ("remaining_accounts", rest))
        };
        let group = |rest: &str| -> String {
            rest.trim_start_matches("ActionGroup::")
                .chars()
                .take_while(|c| c.is_alphanumeric())
                .collect()
        };

        match (expected, check) {
            (Check::EventAuthority(expected_group), Some(("event_authority", rest))) => {
                assert_eq!(group(rest), *expected_group, "{name}")
            }
            (
                Check::LeadingRemainingAccounts(expected_group),
                Some(("remaining_accounts", rest)),
            ) => {
                assert_eq!(group(rest), *expected_group, "{name}")
            }
            (Check::InPinocchioSwap | Check::Never, None) => {}
            (expected, check) => panic!("{name}: expected {expected:?}, found {check:?}"),
        }
    }

    // pinocchio impl
    assert!(
        include_str!("../instructions/swap/ix_p_swap.rs")
            .contains("p_check_circuit_breaker(event_authority, ActionGroup::Swap)?;"),
        "p_handle_swap must check the circuit breaker"
    );
}

struct MockAccountData {
    data: [u8; 1],
    lamports: u64,
    owner: Pubkey,
    key: Pubkey,
}

/// Runs `strip_leading_event_cpi_accounts` on accounts with these keys. Returns whether it
/// returned an event authority and the keys of the accounts left for the handler
fn strip_leading_keys(keys: &[Pubkey]) -> (bool, Vec<Pubkey>) {
    let mut mock_account_data = keys
        .iter()
        .map(|key| MockAccountData {
            data: [0],
            lamports: 0,
            owner: Pubkey::default(),
            key: *key,
        })
        .collect::<Vec<_>>();
    let accounts = mock_account_data
        .iter_mut()
        .map(|data| {
            AccountInfo::new(
                &data.key,
                false,
                false,
                &mut data.lamports,
                &mut data.data,
                &data.owner,
                false,
            )
        })
        .collect::<Vec<_>>();

    let (event_authority, rest) = strip_leading_event_cpi_accounts(&accounts);
    (
        event_authority.is_some(),
        rest.iter().map(|account| *account.key).collect(),
    )
}

#[test]
fn test_strip_leading_event_cpi_accounts() {
    let event_authority = crate::EVENT_AUTHORITY_AND_BUMP.0;
    let program = crate::ID;
    let own_accounts = [Pubkey::new_unique(), Pubkey::new_unique()];

    // Both accounts first, in order: they are split off and the rest is left for the handler
    assert_eq!(
        strip_leading_keys(&[event_authority, program, own_accounts[0], own_accounts[1]]),
        (true, own_accounts.to_vec())
    );
    assert_eq!(
        strip_leading_keys(&[event_authority, program]),
        (true, vec![])
    );

    // Any other list is left unchanged for the handler, like the list of a client built before
    // the circuit breaker
    for keys in [
        vec![],
        own_accounts.to_vec(),
        vec![event_authority],
        vec![event_authority, own_accounts[0], own_accounts[1]],
        vec![program],
        vec![program, event_authority],
        vec![own_accounts[0], event_authority, program],
    ] {
        assert_eq!(strip_leading_keys(&keys), (false, keys));
    }
}
