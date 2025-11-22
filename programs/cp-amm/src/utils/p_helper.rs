use anchor_lang::{
    error::ErrorCode,
    prelude::{ProgramError, Pubkey},
    Result,
};
use pinocchio::{account_info::AccountInfo, entrypoint::ProgramResult};
pub fn p_transfer_from_user(
    authority: &AccountInfo,
    token_mint: &AccountInfo,
    token_owner_account: &AccountInfo,
    destination_token_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    token_flag: u8,
) -> ProgramResult {
    if token_flag == 0 {
        pinocchio_token::instructions::Transfer {
            from: token_owner_account,
            to: destination_token_account,
            authority,
            amount,
        }
        .invoke()?;
    } else {
        let decimals = {
            let mint = unsafe {
                pinocchio_token_2022::state::Mint::from_account_info_unchecked(token_mint)?
            };
            mint.decimals()
        };
        pinocchio_token_2022::instructions::TransferChecked {
            from: token_owner_account,
            mint: token_mint,
            to: destination_token_account,
            authority,
            amount,
            decimals,
            token_program: token_program.key(),
        }
        .invoke()?
    }

    Ok(())
}

pub fn p_transfer_from_pool(
    pool_authority: &AccountInfo,
    token_mint: &AccountInfo,
    token_vault: &AccountInfo,
    token_owner_account: &AccountInfo,
    token_program: &AccountInfo,
    amount: u64,
    token_flag: u8,
) -> ProgramResult {
    let seeds = pinocchio::seeds!(
        crate::constants::seeds::POOL_AUTHORITY_PREFIX,
        &[crate::const_pda::pool_authority::BUMP]
    );
    let signers = &[pinocchio::instruction::Signer::from(&seeds)];

    if token_flag == 0 {
        pinocchio_token::instructions::Transfer {
            from: token_vault,
            to: token_owner_account,
            authority: pool_authority,
            amount,
        }
        .invoke_signed(signers)?
    } else {
        let decimals = {
            let mint = unsafe {
                pinocchio_token_2022::state::Mint::from_account_info_unchecked(token_mint)?
            };
            mint.decimals()
        };
        pinocchio_token_2022::instructions::TransferChecked {
            from: token_vault,
            mint: token_mint,
            to: token_owner_account,
            authority: pool_authority,
            amount,
            decimals,
            token_program: token_program.key(),
        }
        .invoke_signed(signers)?
    }

    Ok(())
}

// same code as AccountLoader load_mut
pub fn p_load_mut<T: anchor_lang::Discriminator>(acc_info: &AccountInfo) -> Result<&mut T> {
    if !acc_info.is_writable() {
        return Err(ErrorCode::AccountNotMutable.into());
    }

    let disc = T::DISCRIMINATOR;
    let mut data = acc_info
        .try_borrow_mut_data()
        .map_err(|_| ProgramError::AccountBorrowFailed)?;

    if data.len() < disc.len() {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let given_disc = &data[..disc.len()];
    if given_disc != disc {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }

    Ok(unsafe { &mut *(data[8..].as_mut_ptr() as *mut T) })
}

pub fn p_accessor_mint(token_account: &AccountInfo) -> Result<Pubkey> {
    // TODO fix error code
    let mint: Pubkey = token_account
        .try_borrow_data()
        .map_err(|_| ProgramError::AccountBorrowFailed)?[..32]
        .try_into()
        .map_err(|_| ErrorCode::AccountDidNotDeserialize)?;

    Ok(mint)
}
