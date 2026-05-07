mod instructions;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("Fr2zPxoMXPTEhRAVDQcJvR3JKsaST7GWY6PDjLJxKy3L");
declare_program!(damm_v2);

#[program]
pub mod cpi_example_damm_v2 {
    use super::*;

    pub fn cpi_initialize_pool(
        ctx: Context<CpiInitializePool>,
        liquidity: u128,
        sqrt_price: u128,
    ) -> Result<()> {
        ctx.accounts.cpi_initialize_pool(liquidity, sqrt_price)
    }

    pub fn cpi_swap2(
        ctx: Context<CpiSwap2>,
        amount_0: u64,
        amount_1: u64,
        swap_mode: u8,
    ) -> Result<()> {
        ctx.accounts.cpi_swap2(amount_0, amount_1, swap_mode)
    }
}
