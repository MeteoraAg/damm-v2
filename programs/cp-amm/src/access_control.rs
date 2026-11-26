use crate::account_loader::load_checked;
use crate::assert_eq_admin;
use crate::state::ActionGroup;
use crate::state::CircuitBreaker;
use crate::state::Operator;
use crate::state::OperatorPermission;
use crate::PoolError;
use anchor_lang::prelude::*;

pub fn is_admin(signer: &Pubkey) -> Result<()> {
    require!(assert_eq_admin(signer.key()), PoolError::InvalidAdmin);
    Ok(())
}

pub fn is_admin_or_operator_self<'info>(
    operator: &AccountLoader<'info, Operator>,
    signer: &Pubkey,
) -> Result<()> {
    if assert_eq_admin(signer.key()) || operator.load()?.whitelisted_address.eq(signer) {
        Ok(())
    } else {
        err!(PoolError::InvalidPermission)
    }
}

pub fn is_valid_operator_role<'info>(
    operator: &AccountLoader<'info, Operator>,
    signer: &Pubkey,
    permission: OperatorPermission,
) -> Result<()> {
    let operator = operator.load()?;

    if operator.whitelisted_address.eq(signer) && operator.is_permission_allow(permission) {
        Ok(())
    } else {
        err!(PoolError::InvalidPermission)
    }
}

/// Checks that `action` is enabled by the circuit breaker, which is stored in the event authority.
///
/// Until `initialize_circuit_breaker` runs, and again after `close_circuit_breaker`, the event
/// authority is an empty system account and every action is enabled. Only this program can put
/// data at its PDA. `close_circuit_breaker` enables every action.
///
/// To change `disabled_actions` without a window in which every
/// action is enabled, the operator closes and initializes the circuit breaker in one transaction.
///
/// Once initialized, the event authority is owned by this program instead of the system program.
/// It still signs every event CPI, which only checks its key and its signature.
///
/// `swap` and `swap2` use the pinocchio version, [crate::p_helper::p_check_circuit_breaker].
pub fn check_circuit_breaker(event_authority: &AccountInfo, action: ActionGroup) -> Result<()> {
    // The endpoints with `#[event_cpi]` already checked the key with
    // `address = crate::EVENT_AUTHORITY_AND_BUMP.0` on their `event_authority` account. Checked
    // again so that a new caller can't pass any other account
    require!(
        event_authority.key.eq(&crate::EVENT_AUTHORITY_AND_BUMP.0),
        ErrorCode::ConstraintAddress
    );

    if event_authority.owner.eq(&System::id()) && event_authority.data_is_empty() {
        return Ok(());
    }

    // checks the owner and the discriminator
    let circuit_breaker = load_checked::<CircuitBreaker>(event_authority)?;
    require!(
        circuit_breaker.is_action_enabled(action),
        PoolError::ActionDisabled
    );
    Ok(())
}

/// Checks the circuit breaker for an endpoint that doesn't have `#[event_cpi]`. The caller can pass
/// the event authority and the program as the first two remaining accounts. If they aren't passed,
/// the check is skipped, so clients built before the circuit breaker keep working.
pub fn check_optional_circuit_breaker(
    remaining_accounts: &[AccountInfo],
    action: ActionGroup,
) -> Result<()> {
    match strip_leading_event_cpi_accounts(remaining_accounts) {
        (Some(event_authority), _) => check_circuit_breaker(event_authority, action),
        (None, _) => Ok(()),
    }
}

/// Splits off the event authority and the program when the client passes them as the first two
/// remaining accounts, in that order, the position that `#[event_cpi]` gives them. For any other
/// list, e.g. from a client built before the circuit breaker, the remaining accounts are returned
/// unchanged with `None`
pub fn strip_leading_event_cpi_accounts<'a, 'info>(
    remaining_accounts: &'a [AccountInfo<'info>],
) -> (Option<&'a AccountInfo<'info>>, &'a [AccountInfo<'info>]) {
    match remaining_accounts {
        [event_authority, program, rest @ ..]
            if event_authority.key.eq(&crate::EVENT_AUTHORITY_AND_BUMP.0)
                && program.key.eq(&crate::ID) =>
        {
            (Some(event_authority), rest)
        }
        _ => (None, remaining_accounts),
    }
}
