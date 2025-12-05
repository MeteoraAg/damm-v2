use crate::assert_eq_admin;
use crate::state::Operator;
use crate::state::OperatorPermission;
use crate::PoolError;
use anchor_lang::prelude::*;

pub fn is_admin(signer: &Pubkey) -> Result<()> {
    require!(assert_eq_admin(signer.key()), PoolError::InvalidAdmin);
    Ok(())
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
        err!(PoolError::InvalidAuthority)
    }
}
