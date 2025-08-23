use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::calculate_transfer_fee_excluded_amount,
    PoolError, SwapParameters,
};
use anchor_lang::prelude::*;

pub fn process_swap_exact_in<'a, 'b, 'info>(
    params: ProcessSwapParams<'a, 'b, 'info>,
) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        amount_0: amount_in,
        amount_1: minimum_amount_out,
        pool,
        token_in_mint,
        token_out_mint,
        fee_mode,
        trade_direction,
        current_point,
    } = params;

    let excluded_transfer_fee_amount_in =
        calculate_transfer_fee_excluded_amount(token_in_mint, amount_in)?.amount;

    require!(excluded_transfer_fee_amount_in > 0, PoolError::AmountIsZero);

    let swap_result = pool.get_swap_result_from_exact_input(
        excluded_transfer_fee_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    let excluded_transfer_fee_amount_out =
        calculate_transfer_fee_excluded_amount(token_out_mint, swap_result.output_amount)?.amount;

    require!(
        excluded_transfer_fee_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    Ok(ProcessSwapResult {
        swap_result,
        swap_in_parameters: SwapParameters {
            amount_in,
            minimum_amount_out,
        },
        included_transfer_fee_amount_in: amount_in,
        included_transfer_fee_amount_out: swap_result.output_amount,
        excluded_transfer_fee_amount_out,
    })
}
