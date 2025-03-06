use anchor_lang::prelude::{Interface, InterfaceAccount};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use num_enum::{IntoPrimitive, TryFromPrimitive};

/// Trade (swap) direction
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, IntoPrimitive, TryFromPrimitive)]
pub enum TradeDirection {
    /// Input token A, output token B
    AtoB,
    /// Input token B, output token A
    BtoA,
}

pub struct SwapDirectionalAccountCtx<'a, 'info> {
    pub token_in_mint: &'a InterfaceAccount<'info, Mint>,
    pub token_out_mint: &'a InterfaceAccount<'info, Mint>,
    pub input_vault_account: &'a InterfaceAccount<'info, TokenAccount>,
    pub output_vault_account: &'a InterfaceAccount<'info, TokenAccount>,
    pub input_program: &'a Interface<'info, TokenInterface>,
    pub output_program: &'a Interface<'info, TokenInterface>,
}
