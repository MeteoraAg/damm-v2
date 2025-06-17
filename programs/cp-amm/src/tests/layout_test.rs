use std::str::FromStr;

use anchor_client::{
    solana_client::rpc_client::RpcClient, solana_sdk::commitment_config::CommitmentConfig,
};
use anchor_lang::prelude::Pubkey;

use crate::state::{Config, Pool};

#[tokio::test(flavor = "multi_thread")]
async fn config_account_layout_backward_compatible() {
    let config_pubkey = Pubkey::from_str("TBuzuEMMQizTjpZhRLaUPavALhZmD8U1hwiw1pWSCSq").unwrap();

    let rpc_url = "https://api.mainnet-beta.solana.com".to_string();
    let client = RpcClient::new_with_commitment(&rpc_url, CommitmentConfig::confirmed());

    // Get and decode account
    let config_account = client
        .get_account(&config_pubkey)
        .expect("Failed to get account");

    let mut data_without_discriminator = config_account.data[8..].to_vec();
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

#[tokio::test(flavor = "multi_thread")]
async fn pool_account_layout_backward_compatible() {
    let config_pubkey = Pubkey::from_str("E8zRkDw3UdzRc8qVWmqyQ9MLj7jhgZDHSroYud5t25A7").unwrap();

    let rpc_url = "https://api.mainnet-beta.solana.com".to_string();
    let client = RpcClient::new_with_commitment(&rpc_url, CommitmentConfig::confirmed());

    // Get and decode account
    let pool_account = client
        .get_account(&config_pubkey)
        .expect("Failed to get account");

    let mut data_without_discriminator = pool_account.data[8..].to_vec();
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
