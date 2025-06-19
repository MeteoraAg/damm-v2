use anchor_lang::solana_program::pubkey::Pubkey;
use const_crypto::ed25519;

pub mod pool_authority {
    use super::*;

    const POOL_AUTHORITY_AND_BUMP: ([u8; 32], u8) = ed25519::derive_program_address(
        &[crate::constants::seeds::POOL_AUTHORITY_PREFIX],
        &crate::ID_CONST.to_bytes(),
    );

    pub const ID: Pubkey = Pubkey::new_from_array(POOL_AUTHORITY_AND_BUMP.0);
    pub const BUMP: u8 = POOL_AUTHORITY_AND_BUMP.1;
}

// Potential optimization on event authority too since anchor internally do Pubkey::find_program_address during runtime.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_const_pool_authority() {
        let (derived_pool_authority, derived_bump) = Pubkey::find_program_address(
            &[crate::constants::seeds::POOL_AUTHORITY_PREFIX],
            &crate::ID,
        );
        // derived_pool_authority = FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM
        assert_eq!(pool_authority::ID, derived_pool_authority);
        assert_eq!(pool_authority::BUMP, derived_bump);
    }
}
