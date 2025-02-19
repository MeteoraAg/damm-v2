use anchor_lang::prelude::Pubkey;

/// get first key, this is same as max(key1, key2)
pub fn get_first_key(key1: Pubkey, key2: Pubkey) -> Pubkey {
    if key1 > key2 {
        return key1;
    }
    key2
}
/// get second key, this is same as min(key1, key2)
pub fn get_second_key(key1: Pubkey, key2: Pubkey) -> Pubkey {
    if key1 > key2 {
        return key2;
    }
    key1
}
