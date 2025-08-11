use anchor_lang::prelude::*;

use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::calculate_transfer_fee_included_amount,
    EvtSwap2, PoolError, SwapMode, SwapParameters2,
};

pub fn process_swap_exact_out<'a, 'b, 'info>(
    params: ProcessSwapParams<'a, 'b, 'info>,
) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        pool_address,
        pool,
        token_in_mint,
        token_out_mint,
        fee_mode,
        trade_direction,
        current_point,
        amount_0: amount_out,
        amount_1: maximum_amount_in,
    } = params;

    let transfer_fee_included_amount_out =
        calculate_transfer_fee_included_amount(token_out_mint, amount_out)?.amount;

    let swap_result = pool.get_swap_exact_out_result(
        transfer_fee_included_amount_out,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    let transfer_fee_included_amount_in = calculate_transfer_fee_included_amount(
        token_in_mint,
        swap_result.included_lp_fee_input_amount,
    )?
    .amount;

    require!(
        transfer_fee_included_amount_in <= maximum_amount_in,
        PoolError::ExceededSlippage
    );

    let current_timestamp = Clock::get()?.unix_timestamp as u64;

    let swap_event_v2 = EvtSwap2 {
        pool: pool_address,
        trade_direction: trade_direction.into(),
        has_referral: fee_mode.has_referral,
        params: SwapParameters2 {
            amount_0: amount_out,
            amount_1: maximum_amount_in,
            swap_mode: SwapMode::ExactOut.into(),
        },
        swap_result,
        actual_amount_in: swap_result.included_lp_fee_input_amount,
        current_timestamp,
    };

    Ok(ProcessSwapResult {
        amount_in: transfer_fee_included_amount_in,
        swap_result,
        evt_swap: swap_event_v2,
    })
}
