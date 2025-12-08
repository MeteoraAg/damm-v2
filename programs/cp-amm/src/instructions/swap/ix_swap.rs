use crate::p_helper::{p_accessor_mint, p_load_mut_checked, validate_mut_token_account};
use crate::{const_pda, state::Pool};
use anchor_lang::{prelude::*, CheckId, CheckOwner};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num_enum::{IntoPrimitive, TryFromPrimitive};

#[repr(u8)]
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    IntoPrimitive,
    TryFromPrimitive,
    AnchorDeserialize,
    AnchorSerialize,
)]
pub enum SwapMode {
    ExactIn,
    PartialFill,
    ExactOut,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SwapParameters {
    pub amount_in: u64,
    pub minimum_amount_out: u64,
}

impl SwapParameters {
    pub fn to_swap_parameters2(&self) -> SwapParameters2 {
        SwapParameters2 {
            amount_0: self.amount_in,
            amount_1: self.minimum_amount_out,
            swap_mode: SwapMode::ExactIn.into(),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct SwapParameters2 {
    /// When it's exact in, partial fill, this will be amount_in. When it's exact out, this will be amount_out
    pub amount_0: u64,
    /// When it's exact in, partial fill, this will be minimum_amount_out. When it's exact out, this will be maximum_amount_in
    pub amount_1: u64,
    /// Swap mode, refer [SwapMode]
    pub swap_mode: u8,
}

#[event_cpi]
#[derive(Accounts)]
pub struct SwapCtx<'info> {
    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
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

    /// referral token account
    #[account(mut)]
    pub referral_token_account: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
}

impl<'info> SwapCtx<'info> {
    pub fn validate_p_accounts(accounts: &[pinocchio::account_info::AccountInfo]) -> Result<()> {
        let [
            pool_authority,
            // #[account(mut, has_one = token_a_vault, has_one = token_b_vault)]
            pool,
            input_token_account,
            output_token_account,
            // #[account(mut, token::token_program = token_a_program, token::mint = token_a_mint)]
            token_a_vault,
            // #[account(mut, token::token_program = token_b_program, token::mint = token_b_mint)]
            token_b_vault,
            token_a_mint,
            token_b_mint,
            payer,
            token_a_program,
            token_b_program,
            referral_token_account,
            event_authority,
            _program,
            ..
        ] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys.into());
        };

        // validate pool authority
        require!(
            pool_authority
                .key()
                .eq(const_pda::pool_authority::ID.as_array()),
            ErrorCode::ConstraintAddress
        );

        let pool: pinocchio::account_info::RefMut<'_, Pool> = p_load_mut_checked(pool)?;

        require!(
            pool.token_a_vault.as_array() == token_a_vault.key(),
            ErrorCode::ConstraintHasOne
        );

        require!(
            pool.token_b_vault.as_array() == token_b_vault.key(),
            ErrorCode::ConstraintHasOne
        );

        // validate input_token_account
        validate_mut_token_account(input_token_account)?;

        // validate output_token_account
        validate_mut_token_account(output_token_account)?;

        // validate token_a_vault
        validate_mut_token_account(token_a_vault)?;
        require!(
            token_a_vault.owner() == token_a_program.key(),
            ErrorCode::ConstraintTokenTokenProgram
        );

        // validate token_b_vault
        validate_mut_token_account(token_b_vault)?;
        require!(
            token_b_vault.owner() == token_b_program.key(),
            ErrorCode::ConstraintTokenTokenProgram
        );

        // validate token a mint
        let token_a_mint_pk = p_accessor_mint(token_a_vault)?;
        require!(
            token_a_mint.key() == token_a_mint_pk.as_array(),
            ErrorCode::ConstraintTokenMint
        );
        Mint::check_owner(&Pubkey::new_from_array(*token_a_mint.owner()))?;

        // validate token b mint
        let token_b_mint_pk = p_accessor_mint(token_b_vault)?;
        require!(
            token_b_mint.key() == token_b_mint_pk.as_array(),
            ErrorCode::ConstraintTokenMint
        );
        Mint::check_owner(&Pubkey::new_from_array(*token_b_mint.owner()))?;

        // validate signer
        require!(payer.is_signer(), ErrorCode::AccountNotSigner);

        // validate token program
        TokenInterface::check_id(&Pubkey::new_from_array(*token_a_program.key()))?;
        TokenInterface::check_id(&Pubkey::new_from_array(*token_b_program.key()))?;

        // validate event authority
        require!(
            event_authority.key() == &crate::EVENT_AUTHORITY_AND_BUMP.0,
            ErrorCode::ConstraintSeeds
        );

        // validate referral account
        if referral_token_account.key() != crate::ID.as_array() {
            validate_mut_token_account(referral_token_account)?;
        }

        Ok(())
    }
}
