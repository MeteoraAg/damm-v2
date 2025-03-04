use anchor_lang::prelude::*;
use anchor_lang::system_program::{create_account, transfer, CreateAccount, Transfer};
use anchor_lang::{prelude::InterfaceAccount, solana_program::program::invoke_signed};
use anchor_spl::token_2022::spl_token_2022::extension::metadata_pointer;
use anchor_spl::token_2022::{initialize_mint2, InitializeMint2};
use anchor_spl::{
    token::Token,
    token_2022::spl_token_2022::{
        self,
        extension::{
            self,
            transfer_fee::{TransferFee, MAX_FEE_BASIS_POINTS},
            BaseStateWithExtensions, ExtensionType, StateWithExtensions,
        },
    },
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use num_enum::{IntoPrimitive, TryFromPrimitive};

use crate::{state::TokenBadge, PoolError};

#[derive(
    AnchorSerialize, AnchorDeserialize, Debug, PartialEq, Eq, IntoPrimitive, TryFromPrimitive,
)]
#[repr(u8)]
pub enum TokenProgramFlags {
    TokenProgram,
    TokenProgram2022,
}

pub fn get_token_program_flags<'a, 'info>(
    token_mint: &'a InterfaceAccount<'info, Mint>,
) -> TokenProgramFlags {
    let token_mint_ai = token_mint.to_account_info();

    if token_mint_ai.owner.eq(&anchor_spl::token::ID) {
        TokenProgramFlags::TokenProgram
    } else {
        TokenProgramFlags::TokenProgram2022
    }
}

/// refer code from Orca
#[derive(Debug)]
pub struct TransferFeeIncludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

#[derive(Debug)]
pub struct TransferFeeExcludedAmount {
    pub amount: u64,
    pub transfer_fee: u64,
}

pub fn calculate_transfer_fee_excluded_amount<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
    transfer_fee_included_amount: u64,
) -> Result<TransferFeeExcludedAmount> {
    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(token_mint)? {
        let transfer_fee = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .ok_or_else(|| PoolError::MathOverflow)?;
        let transfer_fee_excluded_amount = transfer_fee_included_amount
            .checked_sub(transfer_fee)
            .ok_or_else(|| PoolError::MathOverflow)?;
        return Ok(TransferFeeExcludedAmount {
            amount: transfer_fee_excluded_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeExcludedAmount {
        amount: transfer_fee_included_amount,
        transfer_fee: 0,
    })
}

pub fn calculate_transfer_fee_included_amount<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
    transfer_fee_excluded_amount: u64,
) -> Result<TransferFeeIncludedAmount> {
    if transfer_fee_excluded_amount == 0 {
        return Ok(TransferFeeIncludedAmount {
            amount: 0,
            transfer_fee: 0,
        });
    }

    if let Some(epoch_transfer_fee) = get_epoch_transfer_fee(token_mint)? {
        let transfer_fee: u64 =
            if u16::from(epoch_transfer_fee.transfer_fee_basis_points) == MAX_FEE_BASIS_POINTS {
                // edge-case: if transfer fee rate is 100%, current SPL implementation returns 0 as inverse fee.
                // https://github.com/solana-labs/solana-program-library/blob/fe1ac9a2c4e5d85962b78c3fc6aaf028461e9026/token/program-2022/src/extension/transfer_fee/mod.rs#L95

                // But even if transfer fee is 100%, we can use maximum_fee as transfer fee.
                // if transfer_fee_excluded_amount + maximum_fee > u64 max, the following checked_add should fail.
                u64::from(epoch_transfer_fee.maximum_fee)
            } else {
                epoch_transfer_fee
                    .calculate_inverse_fee(transfer_fee_excluded_amount)
                    .ok_or(PoolError::MathOverflow)?
            };

        let transfer_fee_included_amount = transfer_fee_excluded_amount
            .checked_add(transfer_fee)
            .ok_or(PoolError::MathOverflow)?;

        // verify transfer fee calculation for safety
        let transfer_fee_verification = epoch_transfer_fee
            .calculate_fee(transfer_fee_included_amount)
            .unwrap();
        if transfer_fee != transfer_fee_verification {
            // We believe this should never happen
            return Err(PoolError::FeeInverseIsIncorrect.into());
        }

        return Ok(TransferFeeIncludedAmount {
            amount: transfer_fee_included_amount,
            transfer_fee,
        });
    }

    Ok(TransferFeeIncludedAmount {
        amount: transfer_fee_excluded_amount,
        transfer_fee: 0,
    })
}

pub fn get_epoch_transfer_fee<'info>(
    token_mint: &InterfaceAccount<'info, Mint>,
) -> Result<Option<TransferFee>> {
    let token_mint_info = token_mint.to_account_info();
    if *token_mint_info.owner == Token::id() {
        return Ok(None);
    }

    let token_mint_data = token_mint_info.try_borrow_data()?;
    let token_mint_unpacked =
        StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&token_mint_data)?;
    if let Ok(transfer_fee_config) =
        token_mint_unpacked.get_extension::<extension::transfer_fee::TransferFeeConfig>()
    {
        let epoch = Clock::get()?.epoch;
        return Ok(Some(transfer_fee_config.get_epoch_fee(epoch).clone()));
    }

    Ok(None)
}

pub fn transfer_from_user<'a, 'c: 'info, 'info>(
    authority: &'a Signer<'info>,
    token_mint: &'a InterfaceAccount<'info, Mint>,
    token_owner_account: &'a InterfaceAccount<'info, TokenAccount>,
    destination_token_account: &'a InterfaceAccount<'info, TokenAccount>,
    token_program: &'a Interface<'info, TokenInterface>,
    amount: u64,
) -> Result<()> {
    let destination_account = destination_token_account.to_account_info();

    let instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        &token_owner_account.key(),
        &token_mint.key(),
        destination_account.key,
        authority.key,
        &[],
        amount,
        token_mint.decimals,
    )?;

    let account_infos = vec![
        token_owner_account.to_account_info(),
        token_mint.to_account_info(),
        destination_account.to_account_info(),
        authority.to_account_info(),
    ];

    invoke_signed(&instruction, &account_infos, &[])?;

    Ok(())
}

pub fn transfer_from_pool<'c: 'info, 'info>(
    pool_authority: AccountInfo<'info>,
    token_mint: &InterfaceAccount<'info, Mint>,
    token_vault: &InterfaceAccount<'info, TokenAccount>,
    token_owner_account: &InterfaceAccount<'info, TokenAccount>,
    token_program: &Interface<'info, TokenInterface>,
    amount: u64,
    bump: u8,
) -> Result<()> {
    let signer_seeds = pool_authority_seeds!(bump);

    let instruction = spl_token_2022::instruction::transfer_checked(
        token_program.key,
        &token_vault.key(),
        &token_mint.key(),
        &token_owner_account.key(),
        &pool_authority.key(),
        &[],
        amount,
        token_mint.decimals,
    )?;

    let account_infos = vec![
        token_vault.to_account_info(),
        token_mint.to_account_info(),
        token_owner_account.to_account_info(),
        pool_authority.to_account_info(),
    ];

    invoke_signed(&instruction, &account_infos, &[&signer_seeds[..]])?;

    Ok(())
}

pub fn is_supported_mint(mint_account: &InterfaceAccount<Mint>) -> Result<bool> {
    let mint_info = mint_account.to_account_info();
    if *mint_info.owner == Token::id() {
        return Ok(true);
    }

    if spl_token_2022::native_mint::check_id(&mint_account.key()) {
        return Err(PoolError::UnsupportNativeMintToken2022.into());
    }

    let mint_data = mint_info.try_borrow_data()?;
    let mint = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
    let extensions = mint.get_extension_types()?;
    for e in extensions {
        if e != ExtensionType::TransferFeeConfig
            && e != ExtensionType::MetadataPointer
            && e != ExtensionType::TokenMetadata
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn is_token_badge_initialized<'c: 'info, 'info>(
    mint: Pubkey,
    token_badge: &'c AccountInfo<'info>,
) -> Result<bool> {
    let token_badge: AccountLoader<'_, TokenBadge> = AccountLoader::try_from(token_badge)?;
    let token_badge = token_badge.load()?;
    Ok(token_badge.token_mint == mint)
}

pub fn create_position_nft_mint_with_extensions<'info>(
    payer: AccountInfo<'info>,
    position_nft_mint: AccountInfo<'info>,
    mint_authority: AccountInfo<'info>,
    mint_close_authority: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_2022_program: AccountInfo<'info>,
    position: AccountInfo<'info>,
    bump: u8,
) -> Result<()> {
    let extensions = [
        ExtensionType::MintCloseAuthority,
        ExtensionType::MetadataPointer,
    ]
    .to_vec();
    let space =
        ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&extensions)?;

    let lamports = Rent::get()?.minimum_balance(space);

    // create mint account
    create_account(
        CpiContext::new(
            system_program.clone(),
            CreateAccount {
                from: payer.clone(),
                to: position_nft_mint.clone(),
            },
        ),
        lamports,
        space as u64,
        token_2022_program.key,
    )?;

    // initialize token extensions
    for e in extensions {
        match e {
            ExtensionType::MetadataPointer => {
                let ix = metadata_pointer::instruction::initialize(
                    token_2022_program.key,
                    position_nft_mint.key,
                    None,
                    Some(position_nft_mint.key()),
                )?;
                solana_program::program::invoke(
                    &ix,
                    &[token_2022_program.clone(), position_nft_mint.clone()],
                )?;
            }
            ExtensionType::MintCloseAuthority => {
                let ix = spl_token_2022::instruction::initialize_mint_close_authority(
                    token_2022_program.key,
                    position_nft_mint.key,
                    Some(mint_close_authority.key),
                )?;
                solana_program::program::invoke(
                    &ix,
                    &[token_2022_program.clone(), position_nft_mint.clone()],
                )?;
            }
            _ => {
                return err!(PoolError::InvalidExtension);
            }
        }
    }

    // initialize mint account
    initialize_mint2(
        CpiContext::new(
            token_2022_program.clone(),
            InitializeMint2 {
                mint: position_nft_mint.clone(),
            },
        ),
        0,
        mint_authority.key,
        None,
    )?;

    // initialize token metadata
    initialize_token_metadata_extension(
        payer,
        position_nft_mint,
        mint_authority,
        position,
        token_2022_program,
        system_program,
        bump,
    )?;
    Ok(())
}

fn get_metadata_data(position: &Pubkey) -> (String, String, String) {
    return (
        String::from("Meteora Dynamic Amm"),
        String::from("MDA"),
        format!(
            "https://dynamic-ipfs.meteora.ag/mda/position?id={}",
            position.to_string()
        ),
    );
}

pub fn initialize_token_metadata_extension<'info>(
    payer: AccountInfo<'info>,
    position_nft_mint: AccountInfo<'info>,
    mint_authority: AccountInfo<'info>,
    position: AccountInfo<'info>,
    token_2022_program: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    bump: u8,
) -> Result<()> {
    let (name, symbol, uri) = get_metadata_data(position.key);

    let additional_lamports = {
        let metadata = spl_token_metadata_interface::state::TokenMetadata {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            ..Default::default()
        };
        let mint_data = position_nft_mint.try_borrow_data()?;
        let mint_state_unpacked =
            StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&mint_data)?;
        let new_account_len = mint_state_unpacked
            .try_get_new_account_len::<spl_token_metadata_interface::state::TokenMetadata>(
            &metadata,
        )?;
        let new_rent_exempt_lamports = Rent::get()?.minimum_balance(new_account_len);
        let additional_lamports =
            new_rent_exempt_lamports.saturating_sub(position_nft_mint.lamports());
        additional_lamports
    };
    if additional_lamports > 0 {
        let cpi_context = CpiContext::new(
            system_program.clone(),
            Transfer {
                from: payer.clone(),
                to: position_nft_mint.clone(),
            },
        );
        transfer(cpi_context, additional_lamports)?;
    }
    let seeds = pool_authority_seeds!(bump);
    let signer_seeds = &[&seeds[..]];
    solana_program::program::invoke_signed(
        &spl_token_metadata_interface::instruction::initialize(
            token_2022_program.key,
            position_nft_mint.key,
            mint_authority.key,
            position_nft_mint.key,
            mint_authority.key,
            name,
            symbol,
            uri,
        ),
        &[
            position_nft_mint.clone(),
            mint_authority.clone(),
            token_2022_program.clone(),
        ],
        signer_seeds,
    )?;

    Ok(())
}
