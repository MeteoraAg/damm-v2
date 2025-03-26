//! Macro functions
macro_rules! pool_authority_seeds {
    ($bump:expr) => {
        &[b"pool_authority".as_ref(), &[$bump]]
    };
}
