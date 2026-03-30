use anchor_lang::solana_program::pubkey::Pubkey;

use crate::const_pda::pool_authority;

// Potential optimization on event authority too since anchor internally do Pubkey::find_program_address during runtime.
#[test]
fn test_const_pool_authority() {
    let (derived_pool_authority, derived_bump) = Pubkey::find_program_address(
        &[crate::constants::seeds::POOL_AUTHORITY_PREFIX],
        &crate::ID,
    );
    // derived_pool_authority = HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC
    assert_eq!(pool_authority::ID, derived_pool_authority);
    assert_eq!(pool_authority::BUMP, derived_bump);
}
