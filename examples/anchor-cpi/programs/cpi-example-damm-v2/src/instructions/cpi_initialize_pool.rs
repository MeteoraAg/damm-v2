use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::damm_v2;

#[derive(Accounts)]
pub struct CpiInitializePool<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(address = damm_v2::ID)]
    pub damm_program: Program<'info, damm_v2::program::CpAmm>,

    pub config: AccountLoader<'info, damm_v2::accounts::Config>,

    /// CHECK: pool
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,

    /// CHECK: pool authority
    #[account(
        mut,
        // pool authority: https://docs.meteora.ag/developer-guide/guides/damm-v2/overview
        address = Pubkey::from_str_const("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC")
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// CHECK: event authority
    pub event_authority: UncheckedAccount<'info>,

    /// CHECK: position nft mint for partner
    #[account(mut)]
    pub first_position_nft_mint: Signer<'info>,

    /// CHECK: position nft account for partner
    #[account(mut)]
    pub first_position_nft_account: UncheckedAccount<'info>,

    /// CHECK: first position
    #[account(mut)]
    pub first_position: UncheckedAccount<'info>,

    /// Token a mint
    #[account(
        constraint = token_a_mint.key() != token_b_mint.key(),
        mint::token_program = token_a_program,
    )]
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token b mint
    #[account(
        mint::token_program = token_b_program,
    )]
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = signer,
        token::token_program = token_a_program
    )]
    pub payer_token_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = signer,
        token::token_program = token_b_program
    )]
    pub payer_token_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK:
    #[account(mut)]
    pub token_a_vault: UncheckedAccount<'info>,

    /// CHECK:
    #[account(mut)]
    pub token_b_vault: UncheckedAccount<'info>,

    /// Program to create NFT mint/token account and transfer for token22 account
    pub token_2022_program: Program<'info, Token2022>,
    pub token_a_program: Interface<'info, TokenInterface>,
    pub token_b_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> CpiInitializePool<'info> {
    pub fn cpi_initialize_pool(&mut self, liquidity: u128, sqrt_price: u128) -> Result<()> {
        let cpi_accounts = damm_v2::cpi::accounts::InitializePool {
            config: self.config.to_account_info(),
            creator: self.signer.to_account_info(),
            event_authority: self.event_authority.to_account_info(),
            payer: self.signer.to_account_info(),
            payer_token_a: self.payer_token_a.to_account_info(),
            payer_token_b: self.payer_token_b.to_account_info(),
            pool: self.pool.to_account_info(),
            pool_authority: self.pool_authority.to_account_info(),
            position: self.first_position.to_account_info(),
            position_nft_account: self.first_position_nft_account.to_account_info(),
            position_nft_mint: self.first_position_nft_mint.to_account_info(),
            token_a_mint: self.token_a_mint.to_account_info(),
            token_b_mint: self.token_b_mint.to_account_info(),
            token_a_vault: self.token_a_vault.to_account_info(),
            token_b_vault: self.token_b_vault.to_account_info(),
            token_a_program: self.token_a_program.to_account_info(),
            token_b_program: self.token_b_program.to_account_info(),
            token_2022_program: self.token_2022_program.to_account_info(),
            system_program: self.system_program.to_account_info(),
            program: self.damm_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.damm_program.to_account_info(), cpi_accounts);

        let cpi_params = damm_v2::types::InitializePoolParameters {
            activation_point: None,
            liquidity,
            sqrt_price,
        };

        damm_v2::cpi::initialize_pool(cpi_ctx, cpi_params)
    }
}
