use anchor_lang::Discriminator;

use crate::{
    base_fee::fee_time_scheduler::PodAlignedFeeTimeScheduler,
    state::{Config, Pool},
};

use std::fs;

#[test]
fn config_account_layout_backward_compatible() {
    // config account: TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq
    let config_account_data =
        fs::read("./src/tests/fixtures/config_account.bin").expect("Failed to read account data");

    let data_without_discriminator = &config_account_data[Config::DISCRIMINATOR.len()..];
    let config_state: Config = bytemuck::pod_read_unaligned(data_without_discriminator);

    let fee_scheduler = bytemuck::from_bytes::<PodAlignedFeeTimeScheduler>(
        config_state.pool_fees.base_fee.data.as_slice(),
    );

    // Test backward compatibility
    // https://solscan.io/account/TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq#anchorData
    let cliff_fee_numerator = 500000000;
    let base_fee_mode = 1;
    let number_of_period = 120;
    let period_frequency = 60u64;
    let reduction_factor = 417;
    assert_eq!(cliff_fee_numerator, fee_scheduler.cliff_fee_numerator);
    assert_eq!(base_fee_mode, fee_scheduler.base_fee_mode);
    assert_eq!(number_of_period, fee_scheduler.number_of_period);
    assert_eq!(period_frequency, fee_scheduler.period_frequency);
    assert_eq!(reduction_factor, fee_scheduler.reduction_factor);
}

#[test]
fn pool_account_layout_backward_compatible() {
    // pool account: E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7
    let pool_account_data =
        fs::read("./src/tests/fixtures/pool_account.bin").expect("Failed to read account data");

    let data_without_discriminator = &pool_account_data[Pool::DISCRIMINATOR.len()..];
    let pool_state: Pool = bytemuck::pod_read_unaligned(data_without_discriminator);

    let fee_scheduler = bytemuck::from_bytes::<PodAlignedFeeTimeScheduler>(
        pool_state.pool_fees.base_fee.base_fee_info.data.as_slice(),
    );

    // Test backward compatibility
    // https://solscan.io/account/E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7#anchorData
    let cliff_fee_numerator = 500000000;
    let base_fee_mode = 1;
    let number_of_period = 120;
    let period_frequency = 60u64;
    let reduction_factor = 265;
    assert_eq!(cliff_fee_numerator, fee_scheduler.cliff_fee_numerator);
    assert_eq!(base_fee_mode, fee_scheduler.base_fee_mode);
    assert_eq!(number_of_period, fee_scheduler.number_of_period);
    assert_eq!(period_frequency, fee_scheduler.period_frequency);
    assert_eq!(reduction_factor, fee_scheduler.reduction_factor);
}
