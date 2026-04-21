use crate::{
    quote_exact_in,
    tests::{get_compounding_pool, get_pool_account, MACK_USDC_ADDRESS},
};

#[test]
fn test_quote_exact_in() {
    let pool = get_pool_account(MACK_USDC_ADDRESS);

    let current_timestamp: u64 = 1_753_751_761;
    let current_slot: u64 = 356410171;

    let a_to_b: bool = false;
    let has_referral: bool = false;

    let actual_amount_in = u64::MAX;

    let swap_result = quote_exact_in::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        actual_amount_in,
        a_to_b,
        has_referral,
    )
    .unwrap();

    assert!(
        swap_result.output_amount > 0,
        "Expected output amount to be greater than 0"
    );

    println!("swap_result {} {:?}", actual_amount_in, swap_result);
}

#[test]
fn test_quote_exact_in_swap_disabled() {
    let pool = get_pool_account(MACK_USDC_ADDRESS);

    let current_timestamp: u64 = 0;
    let current_slot: u64 = 0;

    let a_to_b: bool = false;
    let has_referral: bool = false;

    let actual_amount_in = u64::MAX;

    let swap_result = quote_exact_in::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        actual_amount_in,
        a_to_b,
        has_referral,
    );

    assert!(swap_result.is_err(), "Expected error when swap is disabled");
}

#[test]
fn test_quote_exact_in_compounding_next_sqrt_price() {
    let pool = get_compounding_pool(1_000_000_000, 1_000_000_000);

    let swap_result = quote_exact_in::get_quote(&pool, 0, 0, 100_000, true, false).unwrap();

    assert!(swap_result.output_amount > 0);
    assert_ne!(
        swap_result.next_sqrt_price, 0,
        "Compounding pool next_sqrt_price must not be zero"
    );
    assert_ne!(
        swap_result.next_sqrt_price, pool.sqrt_price,
        "next_sqrt_price should differ from initial sqrt_price after swap"
    );
}
