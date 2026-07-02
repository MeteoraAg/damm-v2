use crate::state::{Position, PositionDelegatePermission};

#[test]
fn test_position_with_full_permission() {
    let permission: u32 = 0b11111111;
    assert!(
        permission > 1 << (PositionDelegatePermission::VARIANT_COUNT - 1)
            && permission < 1 << PositionDelegatePermission::VARIANT_COUNT
    );

    let position = Position {
        delegate_permission: permission,
        ..Default::default()
    };

    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity));
    assert!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidityToOwner)
    );
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFee));
    assert!(position
        .is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFeeToOwner));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimReward));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimRewardToOwner));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::LockPosition));
}

#[test]
fn test_is_delegate_allowed() {
    let position = Position {
        delegate_permission: 0b0,
        ..Default::default()
    };
    assert!(!position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity));
    assert!(!position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity));

    let position = Position {
        delegate_permission: 0b10001,
        ..Default::default()
    };
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity));
    assert!(!position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity));
    assert!(position
        .is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFeeToOwner));
    assert!(!position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimReward));
}
