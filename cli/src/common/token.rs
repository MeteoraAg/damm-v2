use anchor_client::solana_sdk::signer::Signer;
use anchor_client::Program;
use spl_associated_token_account::instruction::create_associated_token_account;
use std::ops::Deref;

use anchor_client::solana_client::rpc_config::RpcSendTransactionConfig;
use anchor_client::solana_sdk::pubkey::Pubkey;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token;
use anyhow::*;

pub fn get_or_create_ata<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    token_mint: Pubkey,
    wallet_address: Pubkey,
) -> Result<Pubkey> {
    let user_ata = get_associated_token_address(&wallet_address, &token_mint);

    let rpc_client = program.rpc();
    let user_ata_exists = rpc_client.get_account(&user_ata).is_ok();

    match user_ata_exists {
        true => Ok(user_ata),
        false => {
            let builder = program
                .request()
                .instruction(create_associated_token_account(
                    &program.payer(),
                    &wallet_address,
                    &token_mint,
                    &spl_token::ID,
                ));

            builder.send_with_spinner_and_config(transaction_config)?;
            Ok(user_ata)
        }
    }
}