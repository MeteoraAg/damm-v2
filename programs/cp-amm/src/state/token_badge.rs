use anchor_lang::prelude::*;

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
/// Parameter that set by the protocol
pub struct TokenBadge {
    /// token mint
    pub token_mint: Pubkey,
    /// Reserve
    pub _padding: [u8; 128],
}

impl TokenBadge {
    pub fn initialize(&mut self, token_mint: Pubkey) -> Result<()> {
        self.token_mint = token_mint;
        Ok(())
    }
}
