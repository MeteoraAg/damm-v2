use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::signer::Signer, Program };
use anchor_lang::prelude::Pubkey;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token;
use anyhow::*;
use cp_amm::instruction;
use cp_amm::state::Pool;
use cp_amm::accounts;

use crate::common::pda::derive_event_authority_pda;

pub struct FundRewardParams {
    pub pool: Pubkey,
    pub reward_index: u8,
    pub funding_amount: u64,
    pub carry_forward: bool,
}

pub fn funding_reward<C: Deref<Target = impl Signer> + Clone>(
    params: FundRewardParams,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<()> {
    let FundRewardParams { pool, reward_index, funding_amount, carry_forward } = params;
    let pool_state = program.account::<Pool>(pool).unwrap();
    let reward_mint = pool_state.reward_infos[reward_index as usize].mint;
    let reward_vault = pool_state.reward_infos[reward_index as usize].vault;
    let event_authority = derive_event_authority_pda();
    let funder_token_account = get_associated_token_address(&program.payer(), &reward_mint);

    let accounts = accounts::FundRewardCtx {
        pool,
        reward_vault,
        reward_mint,
        funder: program.payer(),
        funder_token_account,
        token_program: token::ID,
        event_authority,
        program: cp_amm::ID,
    };

    let ix = instruction::FundReward {
        reward_index,
        amount: funding_amount,
        carry_forward,
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
