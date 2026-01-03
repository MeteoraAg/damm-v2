use std::mem;

use anchor_lang::{
    error::ErrorCode,
    prelude::{ProgramError, Pubkey},
    require, system_program, CheckOwner, Discriminator, Owner, Result,
};
use anchor_spl::token_interface::TokenAccount;
use bytemuck::Pod;
use pinocchio::{
    account_info::{AccountInfo, RefMut},
    entrypoint::ProgramResult,
    sysvars::instructions::IntrospectedInstruction,
};

pub fn p_transfer_from_user(
    authority: &AccountInfo,
    token_mint: &AccountInfo,
    token_owner_account: &AccountInfo,
    destination_token_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
) -> ProgramResult {
    let decimals = p_accessor_decimals(token_mint)?;
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
) -> ProgramResult {
    let seeds = pinocchio::seeds!(
        crate::constants::seeds::POOL_AUTHORITY_PREFIX,
        &[crate::const_pda::pool_authority::BUMP]
    );
    let signers = &[pinocchio::instruction::Signer::from(&seeds)];

    let decimals = p_accessor_decimals(token_mint)?;
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
) -> Result<RefMut<T>> {
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
) -> Result<RefMut<T>> {
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
