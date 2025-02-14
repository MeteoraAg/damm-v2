use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program };
use anyhow::*;
use cp_amm::{ accounts, ConfigParameters };
use cp_amm::instruction;


use crate::common::pda::{ derive_config_pda, derive_event_authority_pda };

pub fn create_config<C: Deref<Target = impl Signer> + Clone>(
    params: ConfigParameters,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<Pubkey> {
    let config = derive_config_pda(params.index);

    if program.rpc().get_account_data(&config).is_ok() {
        println!("{:?} - Already existed", config);
        return Ok(config);
    }

    let event_authority = derive_event_authority_pda();

    let accounts = accounts::CreateConfigCtx {
        config,
        admin: program.payer(),
        system_program: anchor_client::solana_sdk::system_program::ID,
        event_authority,
        program: cp_amm::ID,
    };

    let ix = instruction::CreateConfig {
        config_parameters: params,
    };

    let mut request_builder = program.request();

    if let Some(compute_unit_price) = compute_unit_price {
        request_builder = request_builder.instruction(compute_unit_price);
    }

    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Initialize config {config}. Signature: {signature:#?}");

    signature?;

    Ok(config)
}
