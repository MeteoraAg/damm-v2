use crate::{
    const_pda,
    state::Pool,
    token::{calculate_transfer_fee_excluded_amount, transfer_from_pool},
    EvtClaimProtocolFee2, PoolError,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts for claiming protocol fees
#[derive(Accounts)]
pub struct ClaimProtocolFee2Ctx<'info> {
    /// receiver token account for the claimed token. validated through the protocol_fee program
    #[account(mut)]
    pub receiver_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_a_program: Interface<'info, TokenInterface>,
    pub token_b_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        has_one = token_a_mint,
        has_one = token_b_mint,
        has_one = token_a_vault,
        has_one = token_b_vault,
    )]
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut)]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(address = const_pda::protocol_fee_authority::ID)]
    pub signer: Signer<'info>,
}

fn get_claim_direction_and_validate_accounts(
    pool: &Pool,
    receiver_token_account: &InterfaceAccount<TokenAccount>,
    token_a_program: &Interface<TokenInterface>,
    token_b_program: &Interface<TokenInterface>,
) -> Result<bool> {
    let receiver_token_mint = receiver_token_account.mint;
    let is_claiming_token_a = receiver_token_mint == pool.token_a_mint;

    require!(
        is_claiming_token_a || receiver_token_mint == pool.token_b_mint,
        PoolError::InvalidClaimProtocolFeeAccounts
    );

    let token_program = if is_claiming_token_a {
        token_a_program.key()
    } else {
        token_b_program.key()
    };

    let receiver_token_account_ai = receiver_token_account.to_account_info();
    require!(
        *receiver_token_account_ai.owner == token_program,
        PoolError::InvalidClaimProtocolFeeAccounts
    );

    Ok(is_claiming_token_a)
}

/// claim protocol fees. called through the protocol_fee program
pub fn handle_claim_protocol_fee2(
    ctx: Context<ClaimProtocolFee2Ctx>,
    max_amount: u64,
) -> Result<()> {
    let mut pool = ctx.accounts.pool.load_mut()?;

    let is_claiming_token_a = get_claim_direction_and_validate_accounts(
        &pool,
        &ctx.accounts.receiver_token_account,
        &ctx.accounts.token_a_program,
        &ctx.accounts.token_b_program,
    )?;

    let amount = if is_claiming_token_a {
        let (amount_a, _) = pool.claim_protocol_fee(max_amount, 0)?;
        amount_a
    } else {
        let (_, amount_b) = pool.claim_protocol_fee(0, max_amount)?;
        amount_b
    };

    if amount == 0 {
        return Ok(());
    }

    let (token_vault, token_mint, token_program) = if is_claiming_token_a {
        (
            &ctx.accounts.token_a_vault,
            &ctx.accounts.token_a_mint,
            &ctx.accounts.token_a_program,
        )
    } else {
        (
            &ctx.accounts.token_b_vault,
            &ctx.accounts.token_b_mint,
            &ctx.accounts.token_b_program,
        )
    };

    let transfer_fee_excluded = calculate_transfer_fee_excluded_amount(
        &token_mint.to_account_info().try_borrow_data()?,
        amount,
    )?;
    require!(
        transfer_fee_excluded.amount > 0,
        PoolError::TransferFeeExcludedAmountIsZero
    );

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        token_mint,
        token_vault,
        &ctx.accounts.receiver_token_account.to_account_info(),
        token_program,
        amount,
    )?;

    // emit! log could be truncated. should not rely on this
    emit!(EvtClaimProtocolFee2 {
        pool: ctx.accounts.pool.key(),
        receiver_token_account: ctx.accounts.receiver_token_account.key(),
        token_mint: token_mint.key(),
        amount,
    });

    Ok(())
}
