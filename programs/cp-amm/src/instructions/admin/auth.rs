use anchor_lang::prelude::*;

pub mod admin {
    use anchor_lang::prelude::Pubkey;
    use anchor_lang::pubkey;

    // https://app.squads.so/squads/3YyYuJDv6nxq94DLioHnh6dizBDy5vjhnbipUTNU4z6r/members
    #[cfg(not(feature = "devnet"))]
    pub const ADMIN: Pubkey = pubkey!("3YyYuJDv6nxq94DLioHnh6dizBDy5vjhnbipUTNU4z6r");

    #[cfg(feature = "devnet")]
    pub const ADMIN: Pubkey = pubkey!("DHLXnJdACTY83yKwnUkeoDjqi4QBbsYGa1v8tJL76ViX");
}

#[cfg(feature = "local")]
pub fn assert_eq_admin(_admin: Pubkey) -> bool {
    true
}

#[cfg(not(feature = "local"))]
pub fn assert_eq_admin(admin: Pubkey) -> bool {
    admin.eq(&crate::admin::admin::ADMIN)
}
