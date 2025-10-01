use crate::{
    quote_partial_fill_in,
    tests::{get_pool_account, SOL_USDC_CL_ADDRESS},
};

#[test]
fn test_quote_partial_fill_in() {
    let pool = get_pool_account(SOL_USDC_CL_ADDRESS);

    let current_timestamp: u64 = 1_753_751_761;
    let current_slot: u64 = 356410171;

    let a_to_b: bool = false;
    let has_referral: bool = false;

    let amount_in = u64::MAX;

    let swap_result = quote_partial_fill_in::get_quote(
        &pool,
        current_timestamp,
        current_slot,
        amount_in,
        a_to_b,
        has_referral,
    )
    .unwrap();

    assert!(
        swap_result.output_amount > 0,
        "Expected output amount to be greater than 0"
    );

    assert!(
        swap_result.included_fee_input_amount < amount_in,
        "Expected consumed input amount to be less than input amount"
    );

    assert_eq!(
        pool.sqrt_max_price, swap_result.next_sqrt_price,
        "Expected next sqrt price to match pool's max price"
    );

    println!(
        "swap_result {} {:?}",
        swap_result.included_fee_input_amount, swap_result
    );
}
