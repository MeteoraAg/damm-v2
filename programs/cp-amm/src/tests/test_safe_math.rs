use crate::safe_math::SafeMath;

#[test]
fn safe_add() {
    assert!(u64::MAX.safe_add(u64::MAX).is_err());
    assert!(100u64.safe_add(100u64).is_ok());
    assert_eq!(100u64.safe_add(100u64).unwrap(), 200u64);
}

#[test]
fn safe_sub() {
    assert!(0u64.safe_sub(u64::MAX).is_err());
    assert!(200u64.safe_sub(100u64).is_ok());
    assert_eq!(200u64.safe_sub(100u64).unwrap(), 100u64);
}

#[test]
fn safe_mul() {
    assert!(u64::MAX.safe_mul(u64::MAX).is_err());
    assert!(100u64.safe_mul(100u64).is_ok());
    assert_eq!(100u64.safe_mul(100u64).unwrap(), 10000u64);
}

#[test]
fn safe_div() {
    assert!(100u64.safe_div(0u64).is_err());
    assert!(200u64.safe_div(100u64).is_ok());
    assert_eq!(200u64.safe_div(100u64), Ok(2u64));
}

#[test]
fn safe_shl() {
    assert!(1u128.safe_shl(8).is_ok());
    assert!(100u128.safe_shl(128).is_err());
    assert_eq!(100u128.safe_shl(8), Ok(25600))
}

#[test]
fn safe_shr() {
    assert!(100u128.safe_shr(1).is_ok());
    assert!(200u128.safe_shr(129).is_err());
    assert_eq!(200u128.safe_shr(1), Ok(100))
}
