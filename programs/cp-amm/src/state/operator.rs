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
pub enum OperatorPermission {
    CreateConfigKey,        // 0
    RemoveConfigKey,        // 1
    CreateTokenBadge,       // 2
    CloseTokenBadge,        // 3
    SetPoolStatus,          // 4
    InitializeReward,       // 5
    UpdateRewardDuration,   // 6
    UpdateRewardFunder,     // 7
    UpdatePoolFees,         // 8
    ClaimProtocolFee,       // 9 - Deprecated. Kept for enum ordering
    ZapProtocolFee,         // 10 - Deprecated. Kept for enum ordering
    FixPool,                // 11
    UpdateConfigPermission, // 12
}

#[account(zero_copy)]
#[derive(InitSpace, Debug, Default)]
pub struct Operator {
    pub whitelisted_address: Pubkey,
    pub permission: u128,  // max 128 actions?
    pub padding: [u64; 2], // padding for future use
}

const_assert_eq!(Operator::INIT_SPACE, 64);

impl Operator {
    pub fn initialize(&mut self, whitelisted_address: Pubkey, permission: u128) {
        self.whitelisted_address = whitelisted_address;
        self.permission = permission;
    }

    pub fn is_permission_allow(&self, permission: OperatorPermission) -> bool {
        let result = self.permission & (1u128 << Into::<u8>::into(permission));
        result != 0
    }
}
