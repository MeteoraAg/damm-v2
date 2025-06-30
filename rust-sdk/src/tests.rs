use std::fs;

use cp_amm::state::Pool;

use crate::{quote_exact_in::quote_exact_in, quote_exact_out::quote_exact_out};

fn get_accounts() -> Pool {
    let account_data = fs::read(&"./fixtures/pool.bin").expect("Failed to read account data");
    let mut data_without_discriminator = account_data[8..].to_vec();
    let pool_state: &Pool = bytemuck::from_bytes(&mut data_without_discriminator);
    *pool_state
}

#[test]
fn test_quote_exact_out_fee_in_b_from_a_for_b() {
    let pool = get_accounts();

    let swap_a_for_b = true;
    let current_timestamp = 1_751_254_510;
    let current_slot = 350_110_761;
    let output_amount = 4005059;
    let exact_out_swap_result = quote_exact_out(
        &pool,
        current_timestamp,
        current_slot,
        output_amount,
        swap_a_for_b,
    )
    .unwrap();

    println!("exact_out_swap_result {:?}", exact_out_swap_result);

    let exact_in_swap_result = quote_exact_in(
        &pool,
        current_timestamp,
        current_slot,
        exact_out_swap_result.1,
        swap_a_for_b,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert_eq!(exact_in_swap_result.output_amount, output_amount);
}

#[test]
fn test_quote_exact_out_fee_in_b_from_b_to_a() {
    let pool = get_accounts();

    let swap_a_for_b = false;
    let current_timestamp = 1_751_254_510;
    let current_slot = 350_110_761;
    let output_amount = 100_000_000_000; // base token
    let exact_out_swap_result = quote_exact_out(
        &pool,
        current_timestamp,
        current_slot,
        output_amount,
        swap_a_for_b,
    )
    .unwrap();

    println!("exact_out_swap_result {:?}", exact_out_swap_result);

    let exact_in_swap_result = quote_exact_in(
        &pool,
        current_timestamp,
        current_slot,
        exact_out_swap_result.1,
        swap_a_for_b,
        false,
    )
    .unwrap();
    println!("exact_in_swap_result {:?}", exact_in_swap_result);

    assert!(exact_in_swap_result.output_amount >= output_amount);
}
