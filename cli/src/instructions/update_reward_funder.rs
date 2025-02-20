use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::signer::Signer, Program };
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use cp_amm::instruction;
use cp_amm::accounts;

use crate::common::pda::derive_event_authority_pda;

pub struct UpdateRewardFunderParams {
    pub pool: Pubkey,
    pub reward_index: u8,
    pub new_funder: Pubkey,
}

pub fn update_reward_funder<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateRewardFunderParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<()> {
    let UpdateRewardFunderParams { pool, reward_index, new_funder } = params;
    let event_authority = derive_event_authority_pda();

    let accounts = accounts::UpdateRewardFunderCtx {
        pool,
        admin: program.payer(),
        event_authority,
        program: cp_amm::ID,
    };

    let ix = instruction::UpdateRewardFunder {
        reward_index,
        new_funder,
    };

    let mut request_builder = program.request();

    if let Some(compute_unit_price) = compute_unit_price {
        request_builder = request_builder.instruction(compute_unit_price);
    }

    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Update reward funder pool {pool} Signature: {signature:#?}");

    signature?;

    Ok(())
}