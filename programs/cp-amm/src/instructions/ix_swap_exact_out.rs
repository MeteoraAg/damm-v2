use anchor_lang::prelude::*;

use crate::{
    activation_handler::ActivationHandler,
    params::swap::{SwapDirectionalAccountCtx, TradeDirection},
    state::CollectFeeMode,
    token::{calculate_transfer_fee_included_amount, transfer_from_pool, transfer_from_user},
    PoolError, SwapCtx,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapExactOutParameters {
    amount_out: u64,
    maximum_amount_in: u64,
}

pub fn handle_swap_exact_out(ctx: Context<SwapCtx>, params: SwapExactOutParameters) -> Result<()> {
    // validate pool can swap
    ctx.accounts.require_swap_access()?;

    let SwapExactOutParameters {
        amount_out,
        maximum_amount_in,
    } = params;

    let trade_direction = ctx.accounts.get_trade_direction();
    let SwapDirectionalAccountCtx {
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    } = ctx.accounts.get_swap_directional_accounts();

    require!(amount_out > 0, PoolError::AmountIsZero);

    let is_referral = ctx.accounts.referral_token_account.is_some();

    let mut pool = ctx.accounts.pool.load_mut()?;

    // update for dynamic fee reference
    let current_timestamp = Clock::get()?.unix_timestamp as u64;
    pool.update_pre_swap(current_timestamp)?;

    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    let transfer_fee_included_amount_out =
        calculate_transfer_fee_included_amount(&token_out_mint, amount_out)?.amount;

    let swap_result = pool.get_swap_result(
        transfer_fee_included_amount_out,
        is_referral,
        trade_direction,
        current_point,
        true,
    )?;

    require!(
        swap_result.input_amount <= maximum_amount_in,
        PoolError::ExceededSlippage
    );
    pool.apply_swap_result(&swap_result, trade_direction, current_timestamp)?;

    let transfer_fee_included_amount_in =
        calculate_transfer_fee_included_amount(&token_in_mint, swap_result.input_amount)?.amount;

    // send to reserve
    transfer_from_user(
        &ctx.accounts.payer,
        token_in_mint,
        &ctx.accounts.input_token_account,
        &input_vault_account,
        input_program,
        transfer_fee_included_amount_in,
    )?;
    // send to user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &token_out_mint,
        &output_vault_account,
        &ctx.accounts.output_token_account,
        output_program,
        swap_result.output_amount,
        ctx.bumps.pool_authority,
    )?;
    // send to referral
    if is_referral {
        let collect_fee_mode = CollectFeeMode::try_from(pool.collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        if collect_fee_mode == CollectFeeMode::OnlyB || trade_direction == TradeDirection::AtoB {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.token_b_mint,
                &ctx.accounts.token_b_vault,
                &ctx.accounts.referral_token_account.clone().unwrap(),
                &ctx.accounts.token_b_program,
                swap_result.referral_fee,
                ctx.bumps.pool_authority,
            )?;
        } else {
            transfer_from_pool(
                ctx.accounts.pool_authority.to_account_info(),
                &ctx.accounts.token_a_mint,
                &ctx.accounts.token_a_vault,
                &ctx.accounts.referral_token_account.clone().unwrap(),
                &ctx.accounts.token_a_program,
                swap_result.referral_fee,
                ctx.bumps.pool_authority,
            )?;
        }
    }

    Ok(())
}
