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

    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFee),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimReward),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::LockPosition),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::PermanentLockPosition),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::LockInnerPosition),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::SplitPosition),
        true
    );
}

#[test]
fn test_is_delegate_allowed() {
    let position = Position {
        delegate_permission: 0b0,
        ..Default::default()
    };
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity),
        false
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity),
        false
    );

    let position = Position {
        delegate_permission: 0b101,
        ..Default::default()
    };
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::AddLiquidity),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::RemoveLiquidity),
        false
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimPositionFee),
        true
    );
    assert_eq!(
        position.is_delegate_permission_allowed(PositionDelegatePermission::ClaimReward),
        false
    );
}
