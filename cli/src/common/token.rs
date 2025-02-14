use std::{ ops::Deref, rc::Rc };
use anyhow::*;
use anchor_client::{
    solana_client::{ rpc_client::RpcClient, rpc_config::RpcSendTransactionConfig },
    solana_sdk::{
        signature::Keypair,
        signer::Signer,
        system_instruction,
    },
    Program,
};
use anchor_spl::token::spl_token::instruction as token_instruction;
use spl_associated_token_account::instruction::create_associated_token_account;
use anchor_lang::prelude::Pubkey;
use anchor_spl::{ associated_token::get_associated_token_address, token::{ spl_token, Mint } };

pub fn get_or_create_ata<C: Deref<Target = impl Signer> + Clone>(
    program: &Program<C>,
    transaction_config: RpcSendTransactionConfig,
    token_mint: Pubkey,
    wallet_address: Pubkey
) -> Result<Pubkey> {
    let user_ata = get_associated_token_address(&wallet_address, &token_mint);

    let rpc_client = program.rpc();
    let user_ata_exists = rpc_client.get_account(&user_ata).is_ok();

    match user_ata_exists {
        true => Ok(user_ata),
        false => {
            let builder = program
                .request()
                .instruction(
                    create_associated_token_account(
                        &program.payer(),
                        &wallet_address,
                        &token_mint,
                        &spl_token::ID
                    )
                );

            builder.send_with_spinner_and_config(transaction_config)?;
            Ok(user_ata)
        }
    }
}

pub fn mint_to(
    program: &Program<Rc<Keypair>>,
    transaction_config: RpcSendTransactionConfig,
    token_mint: Pubkey,
    wallet_address: Pubkey,
    amount: u64
) -> Pubkey {
    let user_ata = get_or_create_ata(
        program,
        transaction_config,
        token_mint,
        wallet_address
    ).unwrap();

    let mint_ix = token_instruction
        ::mint_to(&anchor_spl::token::ID, &token_mint, &user_ata, &wallet_address, &[], amount)
        .unwrap();

    let request_builder = program.request();
    let signature = request_builder
        .instruction(mint_ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Mint Signature {:?}", signature);

    user_ata
}

pub fn create_mint(
    program: &Program<Rc<Keypair>>,
    mint_authority: Pubkey,
    decimals: u8,
    transaction_config: RpcSendTransactionConfig
) -> Pubkey {
    let mint_keypair = Keypair::new();

    let rpc_client: RpcClient = program.rpc();
    let lamport_for_rent_extempt = rpc_client
        .get_minimum_balance_for_rent_exemption(Mint::LEN)
        .unwrap();

    let create_account_ix = system_instruction::create_account(
        &program.payer(),
        &mint_keypair.pubkey(),
        lamport_for_rent_extempt,
        Mint::LEN as u64,
        &anchor_spl::token::ID
    );

    let create_mint_ix = token_instruction
        ::initialize_mint(
            &anchor_spl::token::ID,
            &mint_keypair.pubkey(),
            &mint_authority,
            None,
            decimals
        )
        .unwrap();

    let request_builder = program.request();
    let signature = request_builder
        .instruction(create_account_ix)
        .signer(&mint_keypair)
        .instruction(create_mint_ix)
        .send_with_spinner_and_config(transaction_config);

    println!("Mint {} created. Signature {:?}", mint_keypair.pubkey(), signature);

    mint_keypair.pubkey()
}
