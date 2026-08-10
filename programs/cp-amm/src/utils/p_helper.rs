use std::mem;

use anchor_lang::{
    error::ErrorCode,
    prelude::{ProgramError, Pubkey},
    require, system_program, CheckOwner, Discriminator, Owner, Result,
};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{self, StateWithExtensions},
};
use anchor_spl::token_interface::TokenAccount;
use bytemuck::Pod;
use pinocchio::{
    account_info::{AccountInfo, RefMut},
    instruction::{AccountMeta, Instruction, Signer},
    sysvars::instructions::IntrospectedInstruction,
    ProgramResult,
};

use crate::PoolError;

fn p_get_transfer_hook_program_id(
    token_mint: &AccountInfo,
) -> std::result::Result<Option<Pubkey>, pinocchio::program_error::ProgramError> {
    if token_mint.owner() == anchor_spl::token::ID.as_array() {
        return Ok(None);
    }

    let token_mint_data = token_mint.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)
            .map_err(|_| pinocchio::program_error::ProgramError::InvalidAccountData)?;
    Ok(extension::transfer_hook::get_program_id(
        &token_mint_unpacked,
    ))
}

/// TransferChecked with appended transfer hook accounts
fn p_transfer_checked_with_hook_accounts(
    from: &AccountInfo,
    token_mint: &AccountInfo,
    to: &AccountInfo,
    authority: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    decimals: u8,
    transfer_hook_accounts: &[AccountInfo],
    signers: &[Signer],
) -> ProgramResult {
    let mut account_metas = Vec::with_capacity(4 + transfer_hook_accounts.len());
    account_metas.push(AccountMeta::writable(from.key()));
    account_metas.push(AccountMeta::readonly(token_mint.key()));
    account_metas.push(AccountMeta::writable(to.key()));
    account_metas.push(AccountMeta::readonly_signer(authority.key()));

    let mut account_infos: Vec<&AccountInfo> = Vec::with_capacity(4 + transfer_hook_accounts.len());
    account_infos.push(from);
    account_infos.push(token_mint);
    account_infos.push(to);
    account_infos.push(authority);

    for account in transfer_hook_accounts {
        account_metas.push(AccountMeta::new(
            account.key(),
            account.is_writable(),
            // Reference: https://github.com/solana-program/libraries/blob/e05bf3a438d9bcc4b71a8f3c53897543b62f6fb9/tlv-account-resolution/src/state.rs#L35-L55
            // Always mark an account as a non-signer
            false,
        ));
        account_infos.push(account);
    }

    // Reference: https://github.com/anza-xyz/pinocchio/blob/17b0e862c01a868ea07ef81a2f8a9b4a504bdfed/programs/token-2022/src/instructions/transfer_checked.rs#L53-L56
    // Instruction data layout (matches pinocchio_token_2022 TransferChecked):
    // -  [0]: instruction discriminator (1 byte, u8)
    // -  [1..9]: amount (8 bytes, u64)
    // -  [9]: decimals (1 byte, u8)
    let mut instruction_data = [0u8; 10];
    instruction_data[0] = 12;
    instruction_data[1..9].copy_from_slice(&amount.to_le_bytes());
    instruction_data[9] = decimals;

    let instruction = Instruction {
        program_id: token_program.key(),
        accounts: &account_metas,
        data: &instruction_data,
    };

    pinocchio::cpi::slice_invoke_signed(&instruction, &account_infos, signers)
}

pub fn p_transfer_from_user(
    authority: &AccountInfo,
    token_mint: &AccountInfo,
    token_owner_account: &AccountInfo,
    destination_token_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    transfer_hook_accounts: Option<&[AccountInfo]>,
) -> ProgramResult {
    let decimals = p_accessor_decimals(token_mint)?;

    if p_get_transfer_hook_program_id(token_mint)?.is_some() {
        let Some(transfer_hook_accounts) = transfer_hook_accounts else {
            return Err(PoolError::MissingRemainingAccountForTransferHook.into());
        };

        return p_transfer_checked_with_hook_accounts(
            token_owner_account,
            token_mint,
            destination_token_account,
            authority,
            token_program,
            amount,
            decimals,
            transfer_hook_accounts,
            &[],
        );
    } else if transfer_hook_accounts.is_some() {
        return Err(PoolError::NoTransferHookProgram.into());
    }

    pinocchio_token_2022::instructions::TransferChecked {
        from: token_owner_account,
        mint: token_mint,
        to: destination_token_account,
        authority,
        amount,
        decimals,
        token_program: token_program.key(),
    }
    .invoke()?;

    Ok(())
}

pub fn p_transfer_from_pool(
    pool_authority: &AccountInfo,
    token_mint: &AccountInfo,
    token_vault: &AccountInfo,
    token_owner_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    transfer_hook_accounts: Option<&[AccountInfo]>,
) -> ProgramResult {
    let seeds = pinocchio::seeds!(
        crate::constants::seeds::POOL_AUTHORITY_PREFIX,
        &[crate::const_pda::pool_authority::BUMP]
    );
    let signers = &[Signer::from(&seeds)];

    let decimals = p_accessor_decimals(token_mint)?;
    if p_get_transfer_hook_program_id(token_mint)?.is_some() {
        let Some(transfer_hook_accounts) = transfer_hook_accounts else {
            return Err(PoolError::MissingRemainingAccountForTransferHook.into());
        };

        return p_transfer_checked_with_hook_accounts(
            token_vault,
            token_mint,
            token_owner_account,
            pool_authority,
            token_program,
            amount,
            decimals,
            transfer_hook_accounts,
            signers,
        );
    } else if transfer_hook_accounts.is_some() {
        return Err(PoolError::NoTransferHookProgram.into());
    }

    pinocchio_token_2022::instructions::TransferChecked {
        from: token_vault,
        mint: token_mint,
        to: token_owner_account,
        authority: pool_authority,
        amount,
        decimals,
        token_program: token_program.key(),
    }
    .invoke_signed(signers)?;

    Ok(())
}

// same as AccountLoader load_mut() but check for discriminator and owner
pub fn p_load_mut_checked<T: Pod + Discriminator + Owner>(
    acc_info: &AccountInfo,
) -> Result<RefMut<'_, T>> {
    // validate owner
    require!(
        acc_info.owner().eq(&T::owner().to_bytes()),
        ErrorCode::AccountOwnedByWrongProgram
    );

    if !acc_info.is_writable() {
        return Err(ErrorCode::AccountNotMutable.into());
    }

    let disc = T::DISCRIMINATOR;
    let data = acc_info
        .try_borrow_mut_data()
        .map_err(|err| ProgramError::from(u64::from(err)))?;

    if data.len() < disc.len() {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let given_disc = &data[..disc.len()];
    if given_disc != disc {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }

    Ok(RefMut::map(data, |data| {
        // just panic if it is wrong
        bytemuck::from_bytes_mut(&mut data[disc.len()..mem::size_of::<T>() + disc.len()])
    }))
}

pub fn p_load_mut_unchecked<T: Pod + Discriminator + Owner>(
    acc_info: &AccountInfo,
) -> Result<RefMut<'_, T>> {
    let data = acc_info
        .try_borrow_mut_data()
        .map_err(|err| ProgramError::from(u64::from(err)))?;

    Ok(RefMut::map(data, |data| {
        // just panic if it is wrong
        bytemuck::from_bytes_mut(
            &mut data[T::DISCRIMINATOR.len()..mem::size_of::<T>() + T::DISCRIMINATOR.len()],
        )
    }))
}

// get number of accounts in instruction
// refer: https://github.com/anza-xyz/pinocchio/blob/183a17634e1ad2a33921fd5b0de38c151fb2ec2f/sdk/src/sysvars/instructions.rs#L183
pub fn p_get_number_of_accounts_in_instruction(instruction: &IntrospectedInstruction) -> u16 {
    let num_accounts = u16::from_le_bytes(unsafe { *(instruction.raw as *const [u8; 2]) });
    num_accounts
}

pub fn p_accessor_mint(token_account: &AccountInfo) -> Result<Pubkey> {
    let mint: Pubkey = token_account
        .try_borrow_data()
        .map_err(|err| ProgramError::from(u64::from(err)))?[..32]
        .try_into()
        .map_err(|_| ErrorCode::AccountDidNotDeserialize)?;

    Ok(mint)
}

pub fn p_accessor_decimals(
    token_mint: &AccountInfo,
) -> std::result::Result<u8, pinocchio::program_error::ProgramError> {
    let decimals = token_mint.try_borrow_data()?[44..45][0];
    Ok(decimals)
}

pub fn validate_mut_token_account(token_account: &AccountInfo) -> Result<()> {
    require!(token_account.is_writable(), ErrorCode::AccountNotMutable);
    require!(
        token_account.owner() != system_program::ID.as_array() || token_account.lamports() > 0,
        ErrorCode::AccountNotInitialized
    );
    TokenAccount::check_owner(&Pubkey::new_from_array(*token_account.owner()))?;
    Ok(())
}
