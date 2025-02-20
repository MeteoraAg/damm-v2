use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::signer::Signer, Program };
use anchor_lang::prelude::Pubkey;
use anchor_spl::token;
use anyhow::*;
use cp_amm::instruction;
use cp_amm::state::Pool;
use cp_amm::accounts;

use crate::common::pda::{
    derive_event_authority_pda,
    derive_pool_authority,
    derive_reward_vault_pda,
};

pub struct InitializeRewardParams {
    pub pool: Pubkey,
    pub reward_mint: Pubkey,
    pub reward_duration: u64,
}

pub fn create_reward<C: Deref<Target = impl Signer> + Clone>(
    params: InitializeRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<()> {
    let InitializeRewardParams { pool, reward_mint, reward_duration } = params;
    let pool_authority = derive_pool_authority();
    let pool_state = program.account::<Pool>(pool).unwrap();
    let reward_infos = pool_state.reward_infos;

    if reward_infos[0].initialized() && reward_infos[1].initialized() {
        return Ok(());
    }
    let reward_index = if reward_infos[0].initialized() { 1 } else { 0 };

    let reward_vault = derive_reward_vault_pda(reward_index, pool);
    let event_authority = derive_event_authority_pda();

    let accounts = accounts::InitializeRewardCtx {
        pool,
        pool_authority,
        reward_vault,
        reward_mint,
        admin: program.payer(),
        system_program: anchor_client::solana_sdk::system_program::ID,
        token_program: token::ID,
        event_authority,
        program: cp_amm::ID,
    };

    let ix = instruction::InitializeReward {
        reward_index,
        reward_duration,
        funder: program.payer(),
    };

    let mut request_builder = program.request();

    if let Some(compute_unit_price) = compute_unit_price {
        request_builder = request_builder.instruction(compute_unit_price);
    }

    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Initialize reward for pool {pool} Signature: {signature:#?}");

    signature?;

    Ok(())
}