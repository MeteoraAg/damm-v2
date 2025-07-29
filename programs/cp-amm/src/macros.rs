//! Macro functions
macro_rules! pool_authority_seeds {
    () => {
        &[
            crate::constants::seeds::POOL_AUTHORITY_PREFIX,
            &[crate::const_pda::pool_authority::BUMP],
        ]
    };
}
