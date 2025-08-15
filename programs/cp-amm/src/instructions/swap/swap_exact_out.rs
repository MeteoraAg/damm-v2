use anchor_lang::prelude::*;

use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::calculate_transfer_fee_included_amount,
    PoolError, SwapParameters,
};

pub fn process_swap_exact_out<'a, 'b, 'info>(
    params: ProcessSwapParams<'a, 'b, 'info>,
) -> Result<ProcessSwapResult> {
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

    let included_transfer_fee_amount_out =
        calculate_transfer_fee_included_amount(token_out_mint, amount_out)?.amount;
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

    let included_transfer_fee_amount_in = calculate_transfer_fee_included_amount(
        token_in_mint,
        swap_result.included_fee_input_amount,
    )?
    .amount;

    require!(
        included_transfer_fee_amount_in <= maximum_amount_in,
        PoolError::ExceededSlippage
    );

    Ok(ProcessSwapResult {
        swap_result,
        swap_in_parameters: SwapParameters {
            amount_in: included_transfer_fee_amount_in,
            minimum_amount_out: amount_out,
        },
        included_transfer_fee_amount_in,
        included_transfer_fee_amount_out,
        excluded_transfer_fee_amount_out: amount_out,
    })
}
