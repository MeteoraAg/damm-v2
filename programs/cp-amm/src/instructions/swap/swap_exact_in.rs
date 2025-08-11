use crate::{
    swap::{ProcessSwapParams, ProcessSwapResult},
    token::calculate_transfer_fee_excluded_amount,
    EvtSwap2, PoolError, SwapMode, SwapParameters2,
};
use anchor_lang::prelude::*;

pub fn process_swap_exact_in<'a, 'b, 'info>(
    params: ProcessSwapParams<'a, 'b, 'info>,
) -> Result<ProcessSwapResult> {
    let ProcessSwapParams {
        pool_address,
        pool,
        token_in_mint,
        token_out_mint,
        amount_0: amount_in,
        amount_1: minimum_amount_out,
        fee_mode,
        trade_direction,
        current_point,
    } = params;

    let transfer_fee_excluded_amount_in =
        calculate_transfer_fee_excluded_amount(token_in_mint, amount_in)?.amount;

    require!(transfer_fee_excluded_amount_in > 0, PoolError::AmountIsZero);

    let swap_result =
        pool.get_swap_exact_in_result(amount_in, fee_mode, trade_direction, current_point)?;

    let transfer_fee_excluded_amount_out = calculate_transfer_fee_excluded_amount(
        token_out_mint,
        swap_result.excluded_lp_fee_output_amount,
    )?
    .amount;

    require!(
        transfer_fee_excluded_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    let current_timestamp = Clock::get()?.unix_timestamp as u64;

    let swap_event_v2 = EvtSwap2 {
        pool: pool_address,
        trade_direction: trade_direction.into(),
        has_referral: fee_mode.has_referral,
        params: SwapParameters2 {
            amount_0: amount_in,
            amount_1: minimum_amount_out,
            swap_mode: SwapMode::ExactIn.into(),
        },
        swap_result,
        actual_amount_in: transfer_fee_excluded_amount_in,
        current_timestamp,
    };

    Ok(ProcessSwapResult {
        amount_in,
        swap_result,
        evt_swap: swap_event_v2,
    })
}
