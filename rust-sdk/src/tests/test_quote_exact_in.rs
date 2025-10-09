use std::u64;

use crate::{
    quote::{self, MintTransferFees},
    tests::get_pool_account,
};
use spl_pod::primitives::{PodU16, PodU64};
use spl_token_2022::extension::transfer_fee::TransferFee;

#[test]
fn test_quote_exact_in() {
    let pool = get_pool_account();

    let current_timestamp: u64 = 1_753_751_761;
    let current_slot: u64 = 356410171;

    let a_to_b: bool = false;
    let has_referral: bool = false;

    let actual_amount_in = u64::MAX;

    let quote = quote::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        actual_amount_in,
        a_to_b,
        has_referral,
        &MintTransferFees::default(),
    )
    .unwrap();
    assert_eq!(quote.effective_amount_in, actual_amount_in);
    assert_eq!(quote.input_transfer_fee, 0);
    assert_eq!(quote.effective_amount_out, quote.swap_result.output_amount);
}

#[test]
fn test_quote_propagates_disable_error() {
    let mut pool = get_pool_account();
    pool.pool_status = 1;

    let current_timestamp: u64 = 1_753_751_761;
    let current_slot: u64 = 356410171;
    let actual_amount_in = 1u64;

    let result = quote::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        actual_amount_in,
        true,
        false,
        &MintTransferFees::default(),
    );

    assert!(result.is_err());
}

#[test]
fn test_quote_respects_transfer_fees() {
    let mut pool = get_pool_account();
    pool.token_a_flag = 1;
    pool.token_b_flag = 1;

    let current_timestamp: u64 = 1_753_751_761;
    let current_slot: u64 = 356410171;
    let a_to_b = true;
    let has_referral = false;

    let actual_amount_in = 1_000_000u64;

    let mut input_fee = TransferFee::default();
    input_fee.epoch = PodU64::from(0);
    input_fee.maximum_fee = PodU64::from(2_500u64);
    input_fee.transfer_fee_basis_points = PodU16::from(250u16);

    let mut output_fee = TransferFee::default();
    output_fee.epoch = PodU64::from(0);
    output_fee.maximum_fee = PodU64::from(5_000u64);
    output_fee.transfer_fee_basis_points = PodU16::from(150u16);

    let expected_input_fee = input_fee.calculate_fee(actual_amount_in).unwrap();

    let quote = quote::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        actual_amount_in,
        a_to_b,
        has_referral,
        &MintTransferFees::new(Some(input_fee), Some(output_fee)),
    )
    .unwrap();

    assert_eq!(quote.input_transfer_fee, expected_input_fee);
    assert_eq!(quote.effective_amount_in, actual_amount_in - expected_input_fee);

    let expected_output_fee = output_fee
        .calculate_fee(quote.swap_result.output_amount)
        .unwrap();
    assert_eq!(quote.output_transfer_fee, expected_output_fee);
    assert_eq!(
        quote.effective_amount_out,
        quote.swap_result.output_amount - expected_output_fee
    );
}

#[test]
fn test_quote_errors_when_transfer_fees_unknown() {
    let mut pool = get_pool_account();
    pool.token_a_flag = 1;

    let current_timestamp: u64 = 1_753_751_761;
    let current_slot: u64 = 356410171;

    let result = quote::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        1_000u64,
        true,
        false,
        &MintTransferFees::default(),
    );

    assert!(result.is_err());
}
