pub mod test_quote_exact_in;

use std::fs;

use cp_amm::state::Pool;

fn get_pool_account() -> Pool {
    let account_data = fs::read(&"./fixtures/pool.bin").expect("Failed to read account data");

    let mut data_without_discriminator = account_data[8..].to_vec();
    let &pool: &Pool = bytemuck::from_bytes(&mut data_without_discriminator);

    pool
}
