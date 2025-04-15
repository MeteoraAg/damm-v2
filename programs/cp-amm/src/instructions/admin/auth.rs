use anchor_lang::prelude::*;

#[cfg(not(feature = "devnet"))]
pub mod admin {
    use anchor_lang::{prelude::Pubkey, solana_program::pubkey};

    pub const ADMINS: [Pubkey; 2] = [
        pubkey!("5unTfT2kssBuNvHPY6LbJfJpLqEcdMxGYLWHwShaeTLi"),
        pubkey!("DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX"),
    ];
}

#[cfg(feature = "devnet")]
pub mod admin {
    use anchor_lang::{prelude::Pubkey, solana_program::pubkey};

    pub const ADMINS: [Pubkey; 3] = [
        pubkey!("5unTfT2kssBuNvHPY6LbJfJpLqEcdMxGYLWHwShaeTLi"),
        pubkey!("DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX"),
        pubkey!("4JTYKJAyS7eAXQRSxvMbmqgf6ajf3LR9JrAXpVEcww2q"), // minh
    ];
}

#[cfg(feature = "local")]
pub fn assert_eq_admin(_admin: Pubkey) -> bool {
    true
}

#[cfg(not(feature = "local"))]
pub fn assert_eq_admin(admin: Pubkey) -> bool {
    crate::admin::admin::ADMINS
        .iter()
        .any(|predefined_admin| predefined_admin.eq(&admin))
}
