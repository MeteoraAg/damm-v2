use anchor_lang::prelude::*;

use crate::PoolError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AccountsType {
    TransferHookA,
    TransferHookB,
    TransferHookReward,
    TransferHookReferral,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct RemainingAccountsSlice {
    pub accounts_type: AccountsType,
    pub length: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Default)]
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

#[derive(Debug)]
pub struct ParsedRemainingAccounts<'a, T> {
    pub transfer_hook_a: Option<&'a [T]>,
    pub transfer_hook_b: Option<&'a [T]>,
    pub transfer_hook_reward: Option<&'a [T]>,
    pub transfer_hook_referral: Option<&'a [T]>,
}

impl<'a, T> Default for ParsedRemainingAccounts<'a, T> {
    fn default() -> Self {
        Self {
            transfer_hook_a: None,
            transfer_hook_b: None,
            transfer_hook_reward: None,
            transfer_hook_referral: None,
        }
    }
}

pub fn parse_remaining_accounts<'a, T>(
    remaining_accounts: &mut &'a [T],
    remaining_accounts_slice: &[RemainingAccountsSlice],
    valid_accounts_type_list: &[AccountsType],
) -> Result<ParsedRemainingAccounts<'a, T>> {
    let mut parsed_remaining_accounts = ParsedRemainingAccounts::default();

    for slice in remaining_accounts_slice.iter() {
        require!(
            valid_accounts_type_list.contains(&slice.accounts_type),
            PoolError::InvalidRemainingAccountSlice
        );

        if slice.length == 0 {
            continue;
        }

        let length: usize = slice.length.into();
        require!(
            remaining_accounts.len() >= length,
            PoolError::InsufficientRemainingAccounts
        );

        let accounts = &remaining_accounts[..length];
        *remaining_accounts = &remaining_accounts[length..];

        let parsed_accounts = match slice.accounts_type {
            AccountsType::TransferHookA => &mut parsed_remaining_accounts.transfer_hook_a,
            AccountsType::TransferHookB => &mut parsed_remaining_accounts.transfer_hook_b,
            AccountsType::TransferHookReward => &mut parsed_remaining_accounts.transfer_hook_reward,
            AccountsType::TransferHookReferral => {
                &mut parsed_remaining_accounts.transfer_hook_referral
            }
        };

        require!(
            parsed_accounts.is_none(),
            PoolError::DuplicatedRemainingAccountTypes
        );
        *parsed_accounts = Some(accounts);
    }

    Ok(parsed_remaining_accounts)
}
