use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program };
use anyhow::*;

use cp_amm::accounts;
use cp_amm::instruction;

use crate::common::pda::derive_event_authority_pda;

#[derive(Debug)]
pub struct UpdateConfigParams {
    pub config: Pubkey,
    pub param: u8,
    pub value: u8,
}

pub fn update_config<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateConfigParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<Pubkey> {
    let UpdateConfigParams { config, param, value } = params;

    if program.rpc().get_account_data(&config).is_ok() {
        let event_authority = derive_event_authority_pda();
        let accounts = accounts::UpdateConfigCtx {
            config,
            admin: program.payer(),
            event_authority,
            program: cp_amm::ID,
        };

        let ix = instruction::UpdateConfig {
            param,
            value,
        };

        let mut request_builder = program.request();

        if let Some(compute_unit_price) = compute_unit_price {
            request_builder = request_builder.instruction(compute_unit_price);
        }

        let signature = request_builder
            .accounts(accounts)
            .args(ix)
            .send_with_spinner_and_config(transaction_config);

        println!("Update config {config}. Signature: {signature:#?}");

        signature?;
    }

    Ok(config)
}

#[derive(Debug)]
pub struct UpdatePoolFeeParams {
    pub config: Pubkey,
    pub param: u8,
    pub value: u64,
}

pub fn update_pool_fee<C: Deref<Target = impl Signer> + Clone>(
    params: UpdatePoolFeeParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<Pubkey> {
    let UpdatePoolFeeParams { config, param, value } = params;

    if program.rpc().get_account_data(&config).is_ok() {
        let event_authority = derive_event_authority_pda();
        let accounts = accounts::UpdateConfigCtx {
            config,
            admin: program.payer(),
            event_authority,
            program: cp_amm::ID,
        };

        let ix = instruction::UpdatePoolFee {
            param,
            value,
        };

        let mut request_builder = program.request();

        if let Some(compute_unit_price) = compute_unit_price {
            request_builder = request_builder.instruction(compute_unit_price);
        }

        let signature = request_builder
            .accounts(accounts)
            .args(ix)
            .send_with_spinner_and_config(transaction_config);

        println!("Update config {config}. Signature: {signature:#?}");

        signature?;
    }

    Ok(config)
}
