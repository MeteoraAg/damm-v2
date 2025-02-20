use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::signer::Signer, Program };
use anchor_lang::prelude::Pubkey;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token;
use anyhow::*;
use cp_amm::instruction;
use cp_amm::accounts;
use cp_amm::state::Pool;

use crate::common::pda::{ derive_event_authority_pda, derive_pool_authority };

pub struct WithdrawIneligibleRewardParams {
    pub pool: Pubkey,
    pub reward_index: u8,
}

pub fn withdraw_ineligible_reward<C: Deref<Target = impl Signer> + Clone>(
    params: WithdrawIneligibleRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<()> {
    let WithdrawIneligibleRewardParams { pool, reward_index } = params;

    let pool_state = program.account::<Pool>(pool).unwrap();
    let reward_info = pool_state.reward_infos[reward_index as usize];

    let reward_vault = reward_info.vault;
    let reward_mint = reward_info.mint;
    let pool_authority = derive_pool_authority();
    let event_authority = derive_event_authority_pda();

    let funder_token_account = get_associated_token_address(&program.payer(), &reward_mint);

    let accounts = accounts::WithdrawIneligibleRewardCtx {
        pool,
        pool_authority,
        reward_mint,
        reward_vault,
        funder_token_account,
        funder: program.payer(),
        event_authority,
        token_program: token::ID,
        program: cp_amm::ID,
    };

    let ix = instruction::WithdrawIneligibleReward {
        reward_index,
    };

    let mut request_builder = program.request();

    if let Some(compute_unit_price) = compute_unit_price {
        request_builder = request_builder.instruction(compute_unit_price);
    }

    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Withdraw ineligible reward pool {pool} Signature: {signature:#?}");

    signature?;

    Ok(())
}