pub mod test_calculate_compounding_liquidity;
pub mod test_calculate_concentrated_initial_sqrt_price;
pub mod test_quote_exact_in;
pub mod test_quote_exact_out;
pub mod test_quote_partial_fill_in;

use cp_amm::{
    get_initial_pool_information,
    state::{CollectFeeMode, Pool},
    InitialPoolInformation,
};
use std::fs;

use crate::calculate_initial_sqrt_price::calculate_compounding_initial_sqrt_price_and_liquidity;

pub const MACK_USDC_ADDRESS: &str = "3u2BK3ykdjv1hAeGQwAkZMxjb4otV5yvW7g72uviCaZZ";
pub const SOL_USDC_CL_ADDRESS: &str = "CGPxT5d1uf9a8cKVJuZaJAU76t2EfLGbTmRbfvLLZp5j";

fn get_pool_account(pool_address: &str) -> Pool {
    let path = format!("./fixtures/{}.bin", pool_address);
    let account_data = fs::read(&path).expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &pool: &Pool = bytemuck::from_bytes(&mut data_without_discriminator);

    pool
}

fn get_compounding_pool(token_a_amount: u64, token_b_amount: u64) -> Pool {
    let (sqrt_price, liquidity) =
        calculate_compounding_initial_sqrt_price_and_liquidity(token_a_amount, token_b_amount)
            .expect("Failed to calculate initial sqrt price and liquidity");

    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        sqrt_price,
        ..
    } = get_initial_pool_information(CollectFeeMode::Compounding, 0, 0, sqrt_price, liquidity)
        .expect("Failed to get initial pool information");

    Pool {
        collect_fee_mode: CollectFeeMode::Compounding.into(),
        token_a_amount,
        token_b_amount,
        liquidity,
        sqrt_price,
        ..Default::default()
    }
}
