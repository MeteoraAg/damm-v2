use crate::state::{Operator, OperatorPermission};

#[test]
fn test_initialize_with_full_permission() {
    let permission: u128 = 0b1111111111;
    assert!(permission > 1 << 9 && permission < 1 << 10);

    let operator = Operator {
        permission,
        ..Default::default()
    };

    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateConfigKey),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::RemoveConfigKey),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateTokenBadge),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CloseTokenBadge),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::SetPoolStatus),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateClaimProtocolFeeOperator),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CloseClaimProtocolFeeOperator),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::InitializeReward),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::UpdateRewardDuration),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::UpdateRewardFunder),
        true
    );
}

#[test]
fn test_is_permission_allow() {
    let operator = Operator {
        permission: 0b0,
        ..Default::default()
    };
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateConfigKey),
        false
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::RemoveConfigKey),
        false
    );

    let operator = Operator {
        permission: 0b101,
        ..Default::default()
    };

    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateConfigKey),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::RemoveConfigKey),
        false
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::CreateTokenBadge),
        true
    );
}
