use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num::ToPrimitive;

use crate::{
    activation_handler::ActivationHandler,
    constants::seeds::POOL_AUTHORITY_PREFIX,
    get_pool_access_validator,
    params::swap::TradeDirection,
    state::{fee::FeeMode, Pool},
    token::{
        calculate_transfer_fee_excluded_amount, transfer_from_pool, transfer_from_user,
        TransferFeeExcludedAmount,
    },
    EvtSwapExactIn, PoolError,
};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapExactInParameters {
    amount_in: u64,
    minimum_amount_out: u64,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SwapExactInCtx<'info> {
    /// CHECK: Pool Authority
    #[account(seeds = [POOL_AUTHORITY_PREFIX.as_ref()], bump)]
    pub pool_authority: UncheckedAccount<'info>,

    /// Pool account
    #[account(mut, has_one = token_a_vault, has_one = token_b_vault)]
    pub pool: AccountLoader<'info, Pool>,

    /// The user token account for input token
    #[account(mut)]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The user token account for output token
    #[account(mut)]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for input token
    #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The vault token account for output token
    #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The mint of token a
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The mint of token b
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The user performing the swap
    pub payer: Signer<'info>,

    /// Token a program
    pub token_a_program: Interface<'info, TokenInterface>,

    /// Token b program
    pub token_b_program: Interface<'info, TokenInterface>,

    /// Referral token account
    #[account(mut)]
    pub referral_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

impl<'info> SwapExactInCtx<'info> {
    /// Get the trading direction of the current swap. Eg: USDT -> USDC
    pub fn get_trade_direction(&self) -> TradeDirection {
        if self.input_token_account.mint == self.token_a_mint.key() {
            return TradeDirection::AtoB;
        }
        TradeDirection::BtoA
    }
}

pub fn handle_swap_exact_in(
    ctx: Context<SwapExactInCtx>,
    params: SwapExactInParameters,
) -> Result<()> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_swap(&ctx.accounts.payer.key()),
            PoolError::PoolDisabled
        );
    }

    let SwapExactInParameters {
        amount_in,
        minimum_amount_out,
    } = params;

    let trade_direction = ctx.accounts.get_trade_direction();
    let (
        token_in_mint,
        token_out_mint,
        input_vault_account,
        output_vault_account,
        input_program,
        output_program,
    ) = match trade_direction {
        TradeDirection::AtoB => (
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_a_program,
            &ctx.accounts.token_b_program,
        ),
        TradeDirection::BtoA => (
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_b_program,
            &ctx.accounts.token_a_program,
        ),
    };

    // Transfer-in fee (Token Extension)
    let TransferFeeExcludedAmount {
        amount: transfer_fee_excluded_amount_in,
        ..
    } = calculate_transfer_fee_excluded_amount(&token_in_mint, amount_in)?;
    require!(transfer_fee_excluded_amount_in > 0, PoolError::AmountIsZero);

    // Referral
    let has_referral = ctx.accounts.referral_token_account.is_some();

    // Basic info
    let mut pool = ctx.accounts.pool.load_mut()?;
    let fee_mode = &FeeMode::get_fee_mode(pool.collect_fee_mode, trade_direction, has_referral)?;
    let current_timestamp = Clock::get()?
        .unix_timestamp
        .to_u64()
        .ok_or(PoolError::MathOverflow)?;
    let current_point = ActivationHandler::get_current_point(pool.activation_type)?;

    // Update for dynamic fee references
    pool.update_pre_swap(current_timestamp)?;

    // Swap
    let swap_result = pool.get_swap_result_with_amount_in(
        transfer_fee_excluded_amount_in,
        fee_mode,
        trade_direction,
        current_point,
    )?;

    // Transfer-out fee (Token Extension)
    let TransferFeeExcludedAmount {
        amount: transfer_fee_excluded_amount_out,
        ..
    } = calculate_transfer_fee_excluded_amount(&token_out_mint, swap_result.output_amount)?;
    require!(
        transfer_fee_excluded_amount_out >= minimum_amount_out,
        PoolError::ExceededSlippage
    );

    // Apply the swap result
    pool.apply_swap_result(&swap_result, fee_mode, current_timestamp)?;

    // Send to reserves
    transfer_from_user(
        &ctx.accounts.payer,
        token_in_mint,
        &ctx.accounts.input_token_account,
        &input_vault_account,
        input_program,
        amount_in,
    )?;
    // Send to the user
    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &token_out_mint,
        &output_vault_account,
        &ctx.accounts.output_token_account,
        output_program,
        swap_result.output_amount,
        ctx.bumps.pool_authority,
    )?;
    // Reward the referrer
    if has_referral {
        let (reward_mint, reward_vault, reward_token_program) = if fee_mode.fees_on_token_a {
            (
                &ctx.accounts.token_a_mint,
                &ctx.accounts.token_a_vault,
                &ctx.accounts.token_a_program,
            )
        } else {
            (
                &ctx.accounts.token_b_mint,
                &ctx.accounts.token_b_vault,
                &ctx.accounts.token_b_program,
            )
        };
        transfer_from_pool(
            ctx.accounts.pool_authority.to_account_info(),
            reward_mint,
            reward_vault,
            &ctx.accounts.referral_token_account.clone().unwrap(),
            reward_token_program,
            swap_result.referral_fee,
            ctx.bumps.pool_authority,
        )?;
    }

    emit_cpi!(EvtSwapExactIn {
        pool: ctx.accounts.pool.key(),
        trade_direction: trade_direction.into(),
        params,
        swap_result,
        has_referral,
        actual_amount_in: transfer_fee_excluded_amount_in,
        current_timestamp,
    });

    Ok(())
}
