use anchor_lang::prelude::*;

pub fn p_transfer_from_user(
    authority: &pinocchio::account_info::AccountInfo,
    token_mint: &pinocchio::account_info::AccountInfo,
    token_owner_account: &pinocchio::account_info::AccountInfo,
    destination_token_account: &pinocchio::account_info::AccountInfo,
    token_program: &pinocchio::account_info::AccountInfo,
    amount: u64,
    token_flag: u8,
) -> Result<()> {
    if token_flag == 0 {
        pinocchio_token::instructions::Transfer {
            from: token_owner_account,
            to: destination_token_account,
            authority,
            amount,
        }
        .invoke()
        .unwrap();
    } else {
        let decimals = {
            let mint = unsafe {
                pinocchio_token_2022::state::Mint::from_account_info_unchecked(token_mint).unwrap()
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
        .invoke()
        .unwrap();
    }

    Ok(())
}

pub fn p_transfer_from_pool(
    pool_authority: &pinocchio::account_info::AccountInfo,
    token_mint: &pinocchio::account_info::AccountInfo,
    token_vault: &pinocchio::account_info::AccountInfo,
    token_owner_account: &pinocchio::account_info::AccountInfo,
    token_program: &pinocchio::account_info::AccountInfo,
    amount: u64,
    token_flag: u8,
) -> Result<()> {
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
        .invoke_signed(signers)
        .unwrap();
    } else {
        let decimals = {
            let mint = unsafe {
                pinocchio_token_2022::state::Mint::from_account_info_unchecked(token_mint).unwrap()
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
        .invoke_signed(signers)
        .unwrap();
    }

    Ok(())
}
