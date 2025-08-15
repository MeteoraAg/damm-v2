use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{state::Pool, PermissionlessActionAccess};

#[derive(Copy, Clone, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive)]
#[repr(u8)]
/// Type of the activation
pub enum ActivationType {
    Slot,
    Timestamp,
}

pub trait PoolActionAccess {
    fn can_add_liquidity(&self) -> bool;
    fn can_remove_liquidity(&self) -> bool;
    fn can_swap(&self, sender: &Pubkey) -> bool;
    fn can_create_position(&self) -> bool;
    fn can_lock_position(&self) -> bool;
    fn can_split_position(&self) -> bool;
}

pub fn get_pool_access_validator<'a>(pool: &'a Pool) -> Result<Box<dyn PoolActionAccess + 'a>> {
    let access_validator = PermissionlessActionAccess::new(pool)?;
    Ok(Box::new(access_validator))
}
