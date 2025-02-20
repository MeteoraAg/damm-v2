use anchor_lang::prelude::Pubkey;
use std::{ cmp::max, cmp::min };

use cp_amm::constants::seeds::{
    CONFIG_PREFIX,
    POOL_AUTHORITY_PREFIX,
    POOL_PREFIX,
    REWARD_VAULT_PREFIX,
    TOKEN_BADGE_PREFIX,
    TOKEN_VAULT_PREFIX,
};
use cp_amm::ID;

pub fn derive_config_pda(index: u64) -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_PREFIX.as_ref(), index.to_le_bytes().as_ref()], &ID).0
}

pub fn _derive_pool_pda(token_a_mint: Pubkey, token_b_mint: Pubkey, config: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            POOL_PREFIX.as_ref(),
            config.as_ref(),
            max(token_a_mint, token_b_mint).as_ref(),
            min(token_a_mint, token_b_mint).as_ref(),
        ],
        &ID
    ).0
}

pub fn _derive_token_vault_pda(token_mint: Pubkey, pool: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[TOKEN_VAULT_PREFIX.as_ref(), token_mint.as_ref(), pool.as_ref()],
        &ID
    ).0
}

pub fn derive_pool_authority() -> Pubkey {
    Pubkey::find_program_address(&[POOL_AUTHORITY_PREFIX.as_ref()], &ID).0
}

pub fn _derive_position_pda(pool: Pubkey, owner: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[POOL_PREFIX.as_ref(), pool.as_ref(), owner.as_ref()], &ID).0
}

pub fn derive_token_badge_pda(token_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[TOKEN_BADGE_PREFIX.as_ref(), token_mint.as_ref()], &ID).0
}

pub fn derive_event_authority_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &ID).0
}

pub fn derive_reward_vault_pda(index: u8, pool: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[REWARD_VAULT_PREFIX.as_ref(), pool.as_ref(), index.to_le_bytes().as_ref()],
        &ID
    ).0
}
