use crate::state::{Config, Pool};

use std::fs;

#[test]
fn config_account_layout_backward_compatible() {
    // config account: TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq
    let config_account_data =
        fs::read(&"./src/tests/fixtures/config_account.bin").expect("Failed to read account data");

    let mut data_without_discriminator = config_account_data[8..].to_vec();
    let config_state: &mut Config = bytemuck::from_bytes_mut(&mut data_without_discriminator);

    // Test backward compatibility
    // https://solscan.io/account/TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq#anchorData
    let period_frequency = 60u64;
    let period_frequency_from_bytes =
        u64::from_le_bytes(config_state.pool_fees.base_fee.second_factor);
    assert_eq!(
        period_frequency, period_frequency_from_bytes,
        "Second factor layout should be backward compatible"
    );
    let period_to_bytes = period_frequency.to_le_bytes();
    assert_eq!(
        period_to_bytes,
        config_state.pool_fees.base_fee.second_factor,
    );
}

#[test]
fn pool_account_layout_backward_compatible() {
    // pool account: E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7
    let pool_account_data =
        fs::read(&"./src/tests/fixtures/pool_account.bin").expect("Failed to read account data");

    let mut data_without_discriminator = pool_account_data[8..].to_vec();
    let pool_state: &mut Pool = bytemuck::from_bytes_mut(&mut data_without_discriminator);

    // Test backward compatibility
    // https://solscan.io/account/E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7#anchorData
    let period_frequency = 60u64;
    let period_frequency_from_bytes =
        u64::from_le_bytes(pool_state.pool_fees.base_fee.second_factor);

    assert_eq!(
        period_frequency, period_frequency_from_bytes,
        "Second factor layout should be backward compatible"
    );

    let period_to_bytes = period_frequency.to_le_bytes();
    assert_eq!(period_to_bytes, pool_state.pool_fees.base_fee.second_factor,);
}
