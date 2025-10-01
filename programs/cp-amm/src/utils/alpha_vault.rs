pub mod alpha_vault {
    use anchor_lang::prelude::Pubkey;
    use anchor_lang::pubkey;

    #[cfg(not(feature = "local"))]
    pub const ID: Pubkey = pubkey!("vaU6kP7iNEGkbmPkLmZfGwiGxd4Mob24QQCie5R9kd2");

    #[cfg(feature = "local")]
    pub const ID: pubkey!("SNPmGgnywBvvrAKMLundzG6StojyHTHDLu7T4sdhP4k");

    pub fn derive_vault_pubkey(vault_base: Pubkey, pool: Pubkey) -> Pubkey {
        let (vault_pk, _) = Pubkey::find_program_address(
            &[b"vault", vault_base.as_ref(), pool.as_ref()],
            &self::ID,
        );
        vault_pk
    }
}
