use crate::{
    constants::MAX_OPERATION,
    state::{Operator, OperatorPermission},
};

#[test]
fn test_initialize_with_full_permission() {
    let permission: u128 = 0b11111111111;
    assert!(permission > 1 << (MAX_OPERATION - 1) && permission < 1 << MAX_OPERATION);

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
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::UpdatePoolFees),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::ClaimProtocolFee),
        true
    );
    assert_eq!(
        operator.is_permission_allow(OperatorPermission::ZapProtocolFee),
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
