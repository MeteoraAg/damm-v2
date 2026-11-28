use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::damm_v2;

#[derive(Accounts)]
pub struct CpiSwap2<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: pool
    #[account(mut)]
    pub pool: AccountLoader<'info, damm_v2::accounts::Pool>,

    /// CHECK: pool authority
    #[account(
        mut,
        // pool authority: https://docs.meteora.ag/developer-guide/guides/damm-v2/overview
        address = Pubkey::from_str_const("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC")
    )]
    pub pool_authority: UncheckedAccount<'info>,

    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::authority = signer,
    )]
    pub input_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::authority = signer,
    )]
    pub output_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_a_mint,
    )]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = token_b_mint,
    )]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: event authority
    pub event_authority: UncheckedAccount<'info>,

    pub referral_token_account: Option<AccountInfo<'info>>,

    pub damm_program: Program<'info, damm_v2::program::CpAmm>,
    pub token_a_program: Interface<'info, TokenInterface>,
    pub token_b_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

impl<'info> CpiSwap2<'info> {
    pub fn cpi_swap2(&mut self, amount_0: u64, amount_1: u64, swap_mode: u8) -> Result<()> {
        let cpi_accounts = damm_v2::cpi::accounts::Swap2 {
            event_authority: self.event_authority.to_account_info(),
            pool_authority: self.pool_authority.to_account_info(),
            pool: self.pool.to_account_info(),
            input_token_account: self.input_token_account.to_account_info(),
            output_token_account: self.output_token_account.to_account_info(),
            token_a_vault: self.token_a_vault.to_account_info(),
            token_b_vault: self.token_b_vault.to_account_info(),
            token_a_mint: self.token_a_mint.to_account_info(),
            token_b_mint: self.token_b_mint.to_account_info(),
            payer: self.signer.to_account_info(),
            token_a_program: self.token_a_program.to_account_info(),
            token_b_program: self.token_b_program.to_account_info(),
            referral_token_account: self.referral_token_account.clone(),
            program: self.damm_program.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(self.damm_program.to_account_info(), cpi_accounts);

        let cpi_params = damm_v2::types::SwapParameters2 {
            amount_0,
            amount_1,
            swap_mode,
        };

        damm_v2::cpi::swap2(cpi_ctx, cpi_params)
    }
}
