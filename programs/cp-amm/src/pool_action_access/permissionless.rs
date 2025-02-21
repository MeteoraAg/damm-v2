use anchor_lang::prelude::*;

use crate::{
    constants::activation::{SLOT_BUFFER, TIME_BUFFER},
    safe_math::SafeMath,
    state::{Pool, PoolStatus},
    PoolError,
};

use super::{ActivationType, PoolActionAccess};
pub struct PermissionlessActionAccess {
    is_enabled: bool,
    activation_point: u64,
    pre_activation_point: u64,
    current_point: u64,
    whitelisted_vault: Pubkey,
}

impl PermissionlessActionAccess {
    pub fn new(pool: &Pool) -> Result<Self> {
        let activation_type = ActivationType::try_from(pool.activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        let (current_point, buffer_time) = match activation_type {
            ActivationType::Slot => (Clock::get()?.slot, SLOT_BUFFER),
            ActivationType::Timestamp => (Clock::get()?.unix_timestamp as u64, TIME_BUFFER),
        };
        let pre_activation_point = if pool.activation_point >= buffer_time {
            pool.activation_point.safe_sub(buffer_time)?
        } else {
            0
        };
        Ok(Self {
            is_enabled: pool.pool_status == Into::<u8>::into(PoolStatus::Enable),
            current_point,
            activation_point: pool.activation_point,
            whitelisted_vault: pool.whitelisted_vault,
            pre_activation_point,
        })
    }
}

impl PoolActionAccess for PermissionlessActionAccess {
    fn can_add_liquidity(&self) -> bool {
        self.is_enabled
    }

    fn can_remove_liquidity(&self) -> bool {
        self.current_point >= self.activation_point
    }

    fn can_swap(&self, sender: &Pubkey) -> bool {
        if self.is_enabled {
            if sender.eq(&self.whitelisted_vault) {
                self.current_point >= self.pre_activation_point
            } else {
                self.current_point >= self.activation_point
            }
        } else {
            false
        }
    }

    fn can_create_position(&self) -> bool {
        self.is_enabled
    }
    fn can_lock_position(&self) -> bool {
        self.is_enabled
    }
}
