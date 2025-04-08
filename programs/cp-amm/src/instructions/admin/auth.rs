use anchor_lang::prelude::*;
use five8_const::decode_32_const;

#[cfg(not(feature = "devnet"))]
pub mod admin {
    use super::*;

    pub const ADMINS: [Pubkey; 2] = [
        Pubkey::new_from_array(decode_32_const(
            "5unTfT2kssBuNvHPY6LbJfJpLqEcdMxGYLWHwShaeTLi",
        )),
        Pubkey::new_from_array(decode_32_const(
            "DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX",
        )),
    ];
}

#[cfg(feature = "devnet")]
pub mod admin {
    use super::*;

    pub const ADMINS: [Pubkey; 3] = [
        Pubkey::new_from_array(decode_32_const(
            "5unTfT2kssBuNvHPY6LbJfJpLqEcdMxGYLWHwShaeTLi",
        )),
        Pubkey::new_from_array(decode_32_const(
            "DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX",
        )),
        Pubkey::new_from_array(decode_32_const(
            "4JTYKJAyS7eAXQRSxvMbmqgf6ajf3LR9JrAXpVEcww2q", // minh
        )),
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
