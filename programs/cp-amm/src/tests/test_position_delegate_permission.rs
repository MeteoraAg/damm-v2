use crate::{
    constants::MAX_POSITION_DELEGATE_PERMISSION,
    state::{Position, PositionDelegatePermission},
};

#[test]
fn test_position_with_full_permission() {
    let permission: u128 = 0b11111111;
    assert!(
        permission > 1 << (MAX_POSITION_DELEGATE_PERMISSION - 1)
            && permission < 1 << MAX_POSITION_DELEGATE_PERMISSION
    );

    let position = Position {
        delegate_permission: permission,
        ..Default::default()
    };

    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFee));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimReward));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::LockPosition));
    assert!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::PermanentLockPosition)
    );
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::LockInnerPosition));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::SplitPosition));
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
        delegate_permission: 0b101,
        ..Default::default()
    };
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity));
    assert!(!position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity));
    assert!(position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFee));
    assert!(!position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimReward));
}
