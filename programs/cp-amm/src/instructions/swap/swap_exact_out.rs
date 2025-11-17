use anchor_lang::prelude::*;

use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::calculate_transfer_fee_included_amount,
    PoolError,
};

pub fn process_swap_exact_out<'a>(params: ProcessSwapParams<'a>) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        pool,
        token_in_mint,
        token_out_mint,
        fee_mode,
        trade_direction,
        current_point,
        amount_0: amount_out,
        amount_1: maximum_amount_in,
    } = params;

    // TODO fix unwrap
    let included_transfer_fee_amount_out = calculate_transfer_fee_included_amount(
        &token_out_mint.try_borrow_data().unwrap(),
        amount_out,
    )?
    .amount;
    require!(
        included_transfer_fee_amount_out > 0,
        PoolError::AmountIsZero
    );

    let swap_result = pool.get_swap_result_from_exact_output(
        included_transfer_fee_amount_out,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    // TODO fix unwrap
    let included_transfer_fee_amount_in = calculate_transfer_fee_included_amount(
        &token_in_mint.try_borrow_data().unwrap(),
        swap_result.included_fee_input_amount,
    )?
    .amount;

    require!(
        included_transfer_fee_amount_in <= maximum_amount_in,
        PoolError::ExceededSlippage
    );

    Ok(ProcessSwapResult {
        swap_result,
        included_transfer_fee_amount_in,
        included_transfer_fee_amount_out,
        excluded_transfer_fee_amount_out: amount_out,
    })
}
