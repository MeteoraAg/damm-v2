use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::signer::Signer, Program };
use anchor_lang::prelude::Pubkey;
use anyhow::*;
use cp_amm::instruction;
use cp_amm::accounts;

use crate::common::pda::derive_event_authority_pda;

pub struct UpdateRewardDurationParams {
    pub pool: Pubkey,
    pub reward_index: u8,
    pub new_duration: u64,
}

pub fn update_reward_duration<C: Deref<Target = impl Signer> + Clone>(
    params: UpdateRewardDurationParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<()> {
    let UpdateRewardDurationParams { pool, reward_index, new_duration } = params;
    let event_authority = derive_event_authority_pda();

    let accounts = accounts::UpdateRewardDurationCtx {
        pool,
        admin: program.payer(),
        event_authority,
        program: cp_amm::ID,
    };

    let ix = instruction::UpdateRewardDuration {
        reward_index,
        new_duration,
    };

    let mut request_builder = program.request();

    if let Some(compute_unit_price) = compute_unit_price {
        request_builder = request_builder.instruction(compute_unit_price);
    }

    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Update new duration for pool {pool} Signature: {signature:#?}");

    signature?;

    Ok(())
}
