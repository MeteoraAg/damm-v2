use anchor_lang::prelude::*;
use static_assertions::const_assert_eq;

#[account(zero_copy)]
#[derive(InitSpace, Debug)]
/// Parameter that set by the protocol
pub struct ClaimFeeOperator {
    /// operator
    pub operator: Pubkey,
    /// Reserve
    pub _padding: [u8; 128],
}

const_assert_eq!(ClaimFeeOperator::INIT_SPACE, 160);

impl ClaimFeeOperator {
    pub fn initialize(&mut self, operator: Pubkey) -> Result<()> {
        self.operator = operator;
        Ok(())
    }
}
