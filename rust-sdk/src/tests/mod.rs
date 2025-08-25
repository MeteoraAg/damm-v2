pub mod test_calculate_init_sqrt_price;
pub mod test_quote_exact_in;
pub mod test_quote_exact_out;
pub mod test_quote_partial_fill_in;

use cp_amm::state::Pool;
use std::fs;

pub const MACK_USDC_ADDRESS: &str = "3u2BK3ykdjv1hAeGQwAkZMxjb4otV5yvW7g72uviCaZZ";
pub const SOL_USDC_CL_ADDRESS: &str = "CGPxT5d1uf9a8cKVJuZaJAU76t2EfLGbTmRbfvLLZp5j";

fn get_pool_account(pool_address: &str) -> Pool {
    let path = format!("./fixtures/{}.bin", pool_address);
    let account_data = fs::read(&path).expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &pool: &Pool = bytemuck::from_bytes(&mut data_without_discriminator);

    pool
}
