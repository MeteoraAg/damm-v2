use crate::account_loader::load_checked;
use crate::assert_eq_admin;
use crate::const_pda;
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

/// Checks that `action` is enabled by the circuit breaker, which is stored in the pool authority.
///
/// Until `initialize_circuit_breaker` runs, the pool authority is an empty system account and
/// every action is enabled. Only this program can put data at its PDA, and no instruction removes
/// it once it's there, so it can't go back to that state.
///
/// Once initialized, the pool authority is owned by this program instead of the system program.
/// It still signs every transfer out of the vaults, so transfer hook programs receive a
/// program-owned account as the transfer authority.
///
/// `swap` and `swap2` use the pinocchio version, [crate::p_helper::p_check_circuit_breaker].
pub fn check_circuit_breaker(pool_authority: &AccountInfo, action: ActionGroup) -> Result<()> {
    // The endpoints already checked the key with `address = const_pda::pool_authority::ID` on
    // their `pool_authority` account. Checked again so that a new caller can't pass any other
    // account
    require!(
        pool_authority.key.eq(&const_pda::pool_authority::ID),
        ErrorCode::ConstraintAddress
    );

    // Currently we are not requiring the pool_authority account to be non writable since that's breaking
    // we will require this in the future

    if pool_authority.owner.eq(&System::id()) && pool_authority.data_is_empty() {
        return Ok(());
    }

    // checks the owner and the discriminator
    let circuit_breaker = load_checked::<CircuitBreaker>(pool_authority)?;
    require!(
        circuit_breaker.is_action_enabled(action),
        PoolError::ActionDisabled
    );
    Ok(())
}

/// Checks the circuit breaker for an endpoint that doesn't take `pool_authority` as a named
/// account. Such an endpoint takes it as its last remaining account instead, after any other
/// remaining accounts, so the positions of those don't change.
///
/// The account is optional for now, so that clients built before the circuit breaker keep working:
/// a caller that leaves it out isn't checked. A later release will require it.
pub fn check_optional_circuit_breaker(
    remaining_accounts: &[AccountInfo],
    action: ActionGroup,
) -> Result<()> {
    match remaining_accounts.last() {
        Some(last) if last.key.eq(&const_pda::pool_authority::ID) => {
            check_circuit_breaker(last, action)
        }
        _ => Ok(()),
    }
}
