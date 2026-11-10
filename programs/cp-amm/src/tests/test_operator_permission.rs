use crate::state::{Operator, OperatorPermission};

#[test]
fn test_initialize_with_full_permission() {
    let permission: u128 = 0b111111111111;
    assert!(
        permission > 1 << (OperatorPermission::VARIANT_COUNT - 1)
            && permission < 1 << OperatorPermission::VARIANT_COUNT
    );

    let operator = Operator {
        permission,
        ..Default::default()
    };

    assert!(operator.is_permission_allow(OperatorPermission::CreateConfigKey));
    assert!(operator.is_permission_allow(OperatorPermission::RemoveConfigKey));
    assert!(operator.is_permission_allow(OperatorPermission::CreateTokenBadge));
    assert!(operator.is_permission_allow(OperatorPermission::CloseTokenBadge));
    assert!(operator.is_permission_allow(OperatorPermission::SetPoolStatus));
    assert!(operator.is_permission_allow(OperatorPermission::InitializeReward));
    assert!(operator.is_permission_allow(OperatorPermission::UpdateRewardDuration));
    assert!(operator.is_permission_allow(OperatorPermission::UpdateRewardFunder));
    assert!(operator.is_permission_allow(OperatorPermission::UpdatePoolFees));
    assert!(operator.is_permission_allow(OperatorPermission::ClaimProtocolFee));
    assert!(operator.is_permission_allow(OperatorPermission::ZapProtocolFee));
    assert!(operator.is_permission_allow(OperatorPermission::FixPool));
}

#[test]
fn test_is_permission_allow() {
    let operator = Operator {
        permission: 0b0,
        ..Default::default()
    };
    assert!(!operator.is_permission_allow(OperatorPermission::CreateConfigKey));
    assert!(!operator.is_permission_allow(OperatorPermission::RemoveConfigKey));

    let operator = Operator {
        permission: 0b101,
        ..Default::default()
    };

    assert!(operator.is_permission_allow(OperatorPermission::CreateConfigKey));
    assert!(!operator.is_permission_allow(OperatorPermission::RemoveConfigKey));
    assert!(operator.is_permission_allow(OperatorPermission::CreateTokenBadge));
}
