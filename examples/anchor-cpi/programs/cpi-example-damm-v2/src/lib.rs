use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

declare_id!("FEa6XcabmRuJtMpQSfKqvf1YKD2Y4V1ndt1YyR38gV6");

declare_program!(damm_v2);

#[program]
pub mod cpi_example_damm_v2 {
    use super::*;

    pub fn cpi_initialize_pool(
        ctx: Context<CpiInitializePool>,
        liquidity: u128,
        sqrt_price: u128,
    ) -> Result<()> {
        let acc = ctx.accounts;

        let cpi_accounts = damm_v2::cpi::accounts::InitializePool {
            config: acc.config.to_account_info(),
            creator: acc.signer.to_account_info(),
            event_authority: acc.event_authority.to_account_info(),
            payer: acc.signer.to_account_info(),
            payer_token_a: acc.payer_token_a.to_account_info(),
            payer_token_b: acc.payer_token_b.to_account_info(),
            pool: acc.pool.to_account_info(),
            pool_authority: acc.pool_authority.to_account_info(),
            position: acc.first_position.to_account_info(),
            position_nft_account: acc.first_position_nft_account.to_account_info(),
            position_nft_mint: acc.first_position_nft_mint.to_account_info(),
            token_a_mint: acc.token_a_mint.to_account_info(),
            token_b_mint: acc.token_b_mint.to_account_info(),
            token_a_vault: acc.token_a_vault.to_account_info(),
            token_b_vault: acc.token_b_vault.to_account_info(),
            token_a_program: acc.token_program.to_account_info(),
            token_b_program: acc.token_program.to_account_info(),
            token_2022_program: acc.token_2022_program.to_account_info(),
            system_program: acc.system_program.to_account_info(),
            program: acc.damm_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(acc.damm_program.to_account_info(), cpi_accounts);

        let cpi_params = damm_v2::types::InitializePoolParameters {
            activation_point: None,
            liquidity,
            sqrt_price,
        };

        damm_v2::cpi::initialize_pool(cpi_ctx, cpi_params)
    }
}

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
        address = Pubkey::from_str("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC").unwrap()
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
        mint::token_program = token_program,
    )]
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token b mint
    #[account(
        mint::token_program = token_program,
    )]
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = token_a_mint,
        token::authority = signer,
        token::token_program = token_program
    )]
    pub payer_token_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_b_mint,
        token::authority = signer,
        token::token_program = token_program
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
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}
