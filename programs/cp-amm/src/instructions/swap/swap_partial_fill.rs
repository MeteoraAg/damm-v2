use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::{calculate_transfer_fee_excluded_amount, calculate_transfer_fee_included_amount},
    PoolError, SwapParameters,
};
use anchor_lang::prelude::*;

pub fn process_swap_partial_fill<'a, 'b, 'info>(
    params: ProcessSwapParams<'a, 'b, 'info>,
) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        pool,
        token_in_mint,
        token_out_mint,
        amount_0: amount_in,
        amount_1: minimum_amount_out,
        fee_mode,
        trade_direction,
        current_point,
    } = params;

    let excluded_transfer_fee_amount_in =
        calculate_transfer_fee_excluded_amount(token_in_mint, amount_in)?.amount;

    // redundant check, but it is fine to keep it
    require!(excluded_transfer_fee_amount_in > 0, PoolError::AmountIsZero);

    let swap_result = pool.get_swap_result_from_partial_input(
        excluded_transfer_fee_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    // require in amount is non-zero
    require!(
        swap_result.included_fee_input_amount > 0,
        PoolError::AmountIsZero
    );

    let excluded_transfer_fee_amount_out =
        calculate_transfer_fee_excluded_amount(token_out_mint, swap_result.output_amount)?.amount;

    require!(
        excluded_transfer_fee_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    let transfer_fee_included_consumed_in_amount = calculate_transfer_fee_included_amount(
        token_in_mint,
        swap_result.included_fee_input_amount,
    )?
    .amount;

    Ok(ProcessSwapResult {
        swap_result,
        swap_in_parameters: SwapParameters {
            amount_in: transfer_fee_included_consumed_in_amount,
            minimum_amount_out,
        },
        included_transfer_fee_amount_in: transfer_fee_included_consumed_in_amount,
        included_transfer_fee_amount_out: swap_result.output_amount,
        excluded_transfer_fee_amount_out,
    })
}
