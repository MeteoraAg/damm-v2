use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::instruction::Instruction;
use anchor_client::{ solana_sdk::pubkey::Pubkey, solana_sdk::signer::Signer, Program };
use anyhow::*;
use cp_amm::accounts;
use cp_amm::instruction;

use crate::common::pda::derive_token_badge_pda;

pub fn create_token_badge<C: Deref<Target = impl Signer> + Clone>(
    token_mint: Pubkey,
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    compute_unit_price: Option<Instruction>
) -> Result<Pubkey> {
    let token_badge = derive_token_badge_pda(token_mint);

    if program.rpc().get_account_data(&token_badge).is_ok() {
        return Ok(token_badge);
    }

    let accounts = accounts::CreateTokenBadgeCtx {
        token_mint,
        token_badge,
        admin: program.payer(),
        system_program: anchor_client::solana_sdk::system_program::ID,
    };

    let ix = instruction::CreateTokenBadge {};

    let mut request_builder = program.request();

    if let Some(compute_unit_price) = compute_unit_price {
        request_builder = request_builder.instruction(compute_unit_price);
    }

    let signature = request_builder
        .accounts(accounts)
        .args(ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Initialize token badge {token_badge}  Signature: {signature:#?}");

    signature?;

    Ok(token_badge)
}
