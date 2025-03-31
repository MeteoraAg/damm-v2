use crate::{
    constants::{BASIS_POINT_MAX, BIN_STEP_BPS_DEFAULT, BIN_STEP_BPS_U128_DEFAULT, ONE_Q64},
    state::fee::DynamicFeeStruct,
    tests::price_math::get_price_from_id,
};

#[test]
fn test_bin_step_bps_u128() {
    let result = ONE_Q64
        .checked_mul(BIN_STEP_BPS_DEFAULT.into())
        .unwrap()
        .checked_div(BASIS_POINT_MAX.into())
        .unwrap();
    assert_eq!(result, BIN_STEP_BPS_U128_DEFAULT);
}

#[test]
fn test_delta_bin_id_basic() {
    let upper_bin_id = 100;
    let upper_sqrt_price = get_price_from_id(upper_bin_id, BIN_STEP_BPS_DEFAULT).unwrap();

    let lower_bin_id = 20;
    let lower_sqrt_price = get_price_from_id(lower_bin_id, BIN_STEP_BPS_DEFAULT).unwrap();

    let result = DynamicFeeStruct::get_delta_bin_id(
        BIN_STEP_BPS_U128_DEFAULT,
        upper_sqrt_price,
        lower_sqrt_price,
    )
    .unwrap();

    let actual_delta_bin = (upper_bin_id - lower_bin_id) * 2;
    assert_eq!(result, actual_delta_bin as u128);
}

#[test]
fn test_delta_bin_id_max_delta() {
    let delta_bin = 2_000; // 50% price diff
    let upper_bin_id = 100;
    let upper_sqrt_price = get_price_from_id(upper_bin_id, BIN_STEP_BPS_DEFAULT).unwrap();

    let lower_bin_id = upper_bin_id - delta_bin;
    let lower_sqrt_price = get_price_from_id(lower_bin_id, BIN_STEP_BPS_DEFAULT).unwrap();

    let result = DynamicFeeStruct::get_delta_bin_id(
        BIN_STEP_BPS_U128_DEFAULT,
        upper_sqrt_price,
        lower_sqrt_price,
    )
    .unwrap();

    let diff = (result)
        .checked_sub((delta_bin * 2) as u128)
        .unwrap()
        .checked_mul(100)
        .unwrap()
        .checked_div(result as u128)
        .unwrap();

    println!("diff {}", diff);

    // less than 10%
    assert!(diff < 10);
}

#[test]
fn test_delta_bin_id_zero_movement() {
    let sqrt_price = 1_000_000_000u128;
    let result =
        DynamicFeeStruct::get_delta_bin_id(BIN_STEP_BPS_U128_DEFAULT, sqrt_price, sqrt_price)
            .unwrap();
    assert_eq!(result, 0);
}
