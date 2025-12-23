use crate::constants::zap::{
    MINTS_DISALLOWED_TO_ZAP_OUT, TREASURY_SOL_ADDRESS, TREASURY_USDC_ADDRESS,
};
use crate::safe_math::SafeMath;
use crate::state::OperatorPermission;
use crate::token::{get_token_program_from_flag, validate_ata_token};
use crate::{
    const_pda,
    constants::treasury as TREASURY,
    state::{Operator, Pool},
    token::transfer_from_pool,
};
use crate::{get_zap_amm_processor, PoolError, RawZapOutAmmInfo};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as SYSVAR_IX_ID;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::accessor;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use zap::types::ZapOutParameters;

/// Accounts for zap protocol fees
#[event_cpi]
#[derive(Accounts)]
pub struct ZapProtocolFee<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(mut)]
    pub token_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Receiver token account to receive the zap out fund.
    #[account(mut)]
    pub receiver_token: UncheckedAccount<'info>,

    /// Claim fee operator
    #[account(
        has_one = whitelisted_address
    )]
    pub operator: AccountLoader<'info, Operator>,

    /// Operator
    pub whitelisted_address: Signer<'info>,

    /// Token program
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: Sysvar Instructions account
    #[account(
        address = SYSVAR_IX_ID,
    )]
    pub sysvar_instructions: AccountInfo<'info>,
}

fn validate_accounts_and_return_withdraw_direction<'info>(
    pool: &Pool,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_program: &Interface<'info, TokenInterface>,
) -> Result<bool> {
    require!(
        token_mint.key() == pool.token_a_mint || token_mint.key() == pool.token_b_mint,
        PoolError::InvalidWithdrawProtocolFeeZapAccounts
    );

    let is_withdrawing_token_a = token_mint.key() == pool.token_a_mint;

    if is_withdrawing_token_a {
        require!(
            token_vault.key() == pool.token_a_vault,
            PoolError::InvalidWithdrawProtocolFeeZapAccounts
        );
    } else {
        require!(
            token_vault.key() == pool.token_b_vault,
            PoolError::InvalidWithdrawProtocolFeeZapAccounts
        );
    }

    let token_mint_ai = token_mint.to_account_info();
    require!(
        *token_mint_ai.owner == token_program.key(),
        PoolError::InvalidWithdrawProtocolFeeZapAccounts
    );

    Ok(is_withdrawing_token_a)
}

pub fn handle_zap_protocol_fee(ctx: Context<ZapProtocolFee>, max_amount: u64) -> Result<()> {
    let operator = ctx.accounts.operator.load()?;
    require!(
        operator.is_permission_allow(OperatorPermission::ClaimProtocolFee),
        PoolError::InvalidAuthority
    );

    let mut pool = ctx.accounts.pool.load_mut()?;
    let is_withdrawing_a = validate_accounts_and_return_withdraw_direction(
        &pool,
        &ctx.accounts.token_vault,
        &ctx.accounts.token_mint,
        &ctx.accounts.token_program,
    )?;

    require!(
        !MINTS_DISALLOWED_TO_ZAP_OUT.contains(&ctx.accounts.token_mint.key()),
        PoolError::MintRestrictedFromZap
    );

    let (amount, treasury_paired_destination_token_address) = if is_withdrawing_a {
        let (amount_x, _) = pool.claim_protocol_fee(max_amount, 0)?;

        let treasury_token_y_address = get_associated_token_address_with_program_id(
            &TREASURY::ID,
            &pool.token_b_mint,
            &get_token_program_from_flag(pool.token_b_flag)?,
        );
        (amount_x, treasury_token_y_address)
    } else {
        let (_, amount_y) = pool.claim_protocol_fee(0, max_amount)?;
        let treasury_token_x_address = get_associated_token_address_with_program_id(
            &TREASURY::ID,
            &pool.token_a_mint,
            &get_token_program_from_flag(pool.token_a_flag)?,
        );
        (amount_y, treasury_token_x_address)
    };

    require!(amount > 0, PoolError::AmountIsZero);

    drop(pool);

    let receiver_token_ai = ctx.accounts.receiver_token.to_account_info();

    validate_ata_token(
        &receiver_token_ai,
        &ctx.accounts.whitelisted_address.key(),
        &ctx.accounts.token_mint.key(),
        &ctx.accounts.token_program.key(),
    )?;

    validate_zap_out_to_treasury(
        amount,
        &receiver_token_ai,
        treasury_paired_destination_token_address,
        &ctx.accounts.sysvar_instructions,
    )?;

    transfer_from_pool(
        ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.token_mint,
        &ctx.accounts.token_vault,
        &receiver_token_ai,
        &ctx.accounts.token_program,
        amount,
    )?;

    Ok(())
}

fn validate_zap_out_to_treasury<'info>(
    claimed_amount: u64,
    claimer_token_account: &AccountInfo<'info>,
    treasury_paired_destination_token_address: Pubkey,
    sysvar_instructions_account: &AccountInfo<'info>,
) -> Result<()> {
    let current_index = load_current_index_checked(sysvar_instructions_account)?;

    let current_instruction =
        load_instruction_at_checked(current_index.into(), sysvar_instructions_account)?;

    // Ensure the instruction is direct instruction call
    require!(
        current_instruction.program_id == crate::ID,
        PoolError::CpiDisabled
    );

    search_and_validate_zap_out_instruction(
        current_index,
        claimed_amount,
        sysvar_instructions_account,
        claimer_token_account,
        treasury_paired_destination_token_address,
    )
}

// Search for zap out instruction in the next instruction after the current one
fn search_and_validate_zap_out_instruction<'info>(
    current_index: u16,
    max_claim_amount: u64,
    sysvar_instructions_account: &AccountInfo<'info>,
    claimer_token_account: &AccountInfo<'info>,
    treasury_paired_destination_token_address: Pubkey,
) -> Result<()> {
    // Zap out instruction must be next to current instruction
    let next_index = current_index.safe_add(1)?;
    let ix = load_instruction_at_checked(next_index.into(), sysvar_instructions_account)?;

    require!(
        ix.program_id == zap::ID,
        PoolError::MissingZapOutInstruction
    );

    let disc = ix
        .data
        .get(..8)
        .ok_or_else(|| PoolError::InvalidZapOutParameters)?;
    require!(
        disc == zap::client::args::ZapOut::DISCRIMINATOR,
        PoolError::MissingZapOutInstruction
    );

    let zap_params = ZapOutParameters::try_from_slice(&ix.data[8..])?;

    let ZapOutAmmInfo {
        zap_user_token_in_address,
        amm_source_token_address: source_token_address,
        amm_destination_token_address: destination_token_address,
        amount_in_offset,
    } = extract_amm_accounts_and_info(&zap_params, &ix.accounts)?;

    // Zap out from operator fee receiving account
    validate_zap_parameters(
        &zap_params,
        max_claim_amount,
        amount_in_offset,
        claimer_token_account,
    )?;

    // There's no validation to make sure that `user_token_in_account` is the same as `amm_source_token_address`
    // Operator could steal the fund by providing a fake token account with 0 to bypass the zap swap invoke
    // https://github.com/MeteoraAg/zap-program/blob/117e7d5586aa27cf97e6fde6266e25ee4e496f18/programs/zap/src/instructions/ix_zap_out.rs#L91
    require!(
        zap_user_token_in_address == claimer_token_account.key(),
        PoolError::InvalidZapAccounts
    );

    // Zap out from operator fee receiving account
    require!(
        source_token_address == claimer_token_account.key(),
        PoolError::InvalidZapAccounts
    );

    // Zap to paired mint in the pool, or SOL, or USDC treasury
    require!(
        destination_token_address == treasury_paired_destination_token_address
            || destination_token_address == TREASURY_USDC_ADDRESS
            || destination_token_address == TREASURY_SOL_ADDRESS,
        PoolError::InvalidZapAccounts
    );

    Ok(())
}

fn validate_zap_parameters<'info>(
    zap_params: &ZapOutParameters,
    max_claim_amount: u64,
    amount_in_offset: u16,
    claimer_token_account: &AccountInfo<'info>,
) -> Result<()> {
    require!(
        zap_params.percentage == 100,
        PoolError::InvalidZapOutParameters
    );

    require!(
        zap_params.offset_amount_in == amount_in_offset,
        PoolError::InvalidZapOutParameters
    );

    // Ensure no stealing from operator by setting a higher pre_token_balance than actual balance to steal fund
    // Eg: Operator set 100 pre balance, but actual balance is 0
    // Actual claimed amount is 300
    // Zap will attempt to swap post - pre = 300 - 100 = 200
    // Leftover 100 will be stolen by operator
    require!(
        zap_params.pre_user_token_balance == accessor::amount(claimer_token_account)?,
        PoolError::InvalidZapOutParameters
    );

    require!(
        zap_params.max_swap_amount == max_claim_amount,
        PoolError::InvalidZapOutParameters
    );

    Ok(())
}

struct ZapOutAmmInfo {
    // Account used to compare delta changes with pre_balance to decide swap amount
    zap_user_token_in_address: Pubkey,
    amm_source_token_address: Pubkey,
    amm_destination_token_address: Pubkey,
    amount_in_offset: u16,
}

fn extract_amm_accounts_and_info(
    zap_params: &ZapOutParameters,
    zap_account: &[AccountMeta],
) -> Result<ZapOutAmmInfo> {
    // Accounts in ZapOutCtx
    const ZAP_OUT_ACCOUNTS_LEN: usize = 2;

    let zap_user_token_in_address = zap_account
        .get(0)
        .map(|acc| acc.pubkey)
        .ok_or_else(|| PoolError::InvalidZapAccounts)?;

    let zap_amm_program_address = zap_account
        .get(1)
        .map(|acc| acc.pubkey)
        .ok_or_else(|| PoolError::InvalidZapAccounts)?;

    let amm_disc = zap_params
        .payload_data
        .get(..8)
        .ok_or_else(|| PoolError::InvalidZapOutParameters)?;

    let zap_info_processor = get_zap_amm_processor(amm_disc, zap_amm_program_address)?;

    let amm_payload = zap_params
        .payload_data
        .get(8..)
        .ok_or_else(|| PoolError::InvalidZapOutParameters)?;

    zap_info_processor.validate_payload(&amm_payload)?;

    let RawZapOutAmmInfo {
        source_index,
        destination_index,
        amount_in_offset,
    } = zap_info_processor.extract_raw_zap_out_amm_info(zap_params)?;

    // Start from remaining accounts of zap program
    let amm_accounts = zap_account
        .get(ZAP_OUT_ACCOUNTS_LEN..)
        .ok_or_else(|| PoolError::InvalidZapAccounts)?;

    let source_token_address = amm_accounts
        .get(source_index)
        .map(|acc| acc.pubkey)
        .ok_or_else(|| PoolError::InvalidZapAccounts)?;

    let destination_token_address = amm_accounts
        .get(destination_index)
        .map(|acc| acc.pubkey)
        .ok_or_else(|| PoolError::InvalidZapAccounts)?;

    Ok(ZapOutAmmInfo {
        zap_user_token_in_address,
        amm_source_token_address: source_token_address,
        amm_destination_token_address: destination_token_address,
        amount_in_offset,
    })
}
