use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program };
use anyhow::*;

use cp_amm::accounts;
use cp_amm::instruction;

use crate::common::pda::derive_event_authority_pda;

#[derive(Debug)]
pub struct CloseConfigParams {
    pub config: Pubkey,
    pub rent_receiver: Pubkey,
}

pub fn close_config<C: Deref<Target = impl Signer> + Clone>(
    params: CloseConfigParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<Pubkey> {
    let CloseConfigParams { config, rent_receiver } = params;

    if program.rpc().get_account_data(&config).is_ok() {
        let event_authority = derive_event_authority_pda();

        let accounts = accounts::CloseConfigCtx {
            config,
            admin: program.payer(),
            rent_receiver,
            event_authority,
            program: cp_amm::ID,
        };

        let ix = instruction::CloseConfig {};

        let mut request_builder = program.request();

        if let Some(compute_unit_price) = compute_unit_price {
            request_builder = request_builder.instruction(compute_unit_price);
        }

        let signature = request_builder
            .accounts(accounts)
            .args(ix)
            .send_with_spinner_and_config(transaction_config);

        println!("Closed config {config}. Signature: {signature:#?}");

        signature?;
    }

    Ok(config)
}
