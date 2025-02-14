// #![allow(dead_code)]
// #![allow(unused_variables)]
//! E2E test for CLI. The test require a running local solana test validator. Run local solana test validator by: anchor localnet -- --features local
use anchor_client::solana_client::rpc_client::RpcClient;
use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::commitment_config::CommitmentConfig;
use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_client::solana_sdk::signature::{ read_keypair_file, Keypair, Signer };
use anchor_client::{ Client, Program };
use anchor_lang::solana_program::system_instruction;
use std::rc::Rc;

use crate::instructions::{ create_config::create_config, close_config::close_config };
use cp_amm::{ accounts, ConfigParameters };
use cp_amm::params::pool_fees::PoolFees;

const TRANSACTION_CONFIG: RpcSendTransactionConfig = RpcSendTransactionConfig {
    skip_preflight: false,
    preflight_commitment: Some(
        anchor_client::solana_sdk::commitment_config::CommitmentLevel::Confirmed
    ),
    encoding: None,
    max_retries: None,
    min_context_slot: None,
};

fn load_local_keypair() -> Keypair {
    // read_keypair_file("./local/admin-bossj3JvwiNK7pvjr149DqdtJxf2gdygbcmEPTkb2F1.json").unwrap()
    read_keypair_file("/Users/minhdo/.config/solana/id.json").unwrap()
}

fn create_local_program(payer: Rc<Keypair>) -> Program<Rc<Keypair>> {
    let client = Client::new_with_options(
        anchor_client::Cluster::Localnet,
        Rc::clone(&payer),
        CommitmentConfig::confirmed()
    );

    client.program(cp_amm::ID).unwrap()
}

#[test]
fn test_create_config() {
    let payer = Rc::new(load_local_keypair());
    let program = create_local_program(Rc::clone(&payer));
    let pool_fees = PoolFees {
        trade_fee_numerator: 2_500_000,
        protocol_fee_percent: 10,
        partner_fee_percent: 0,
        referral_fee_percent: 0,
        dynamic_fee: None,
    };
    //
    let create_config_params = ConfigParameters {
        pool_fees,
        sqrt_min_price: 0,
        sqrt_max_price: u128::MAX,
        vault_config_key: Pubkey::default(),
        pool_creator_authority: Pubkey::default(),
        activation_type: 0,
        collect_fee_mode: 1,
        index: 0,
    };

    assert!(create_config(create_config_params, &program, TRANSACTION_CONFIG, None).is_ok())
}