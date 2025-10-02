use anchor_lang::{
    prelude::{event::EVENT_IX_TAG_LE, *},
    solana_program,
};

use crate::{entry, p_event_dispatch, p_handle_swap, SWAP_IX_ACCOUNTS};

#[inline(always)]
unsafe fn p_entrypoint(input: *mut u8) -> Option<u64> {
    const UNINIT: core::mem::MaybeUninit<pinocchio::account_info::AccountInfo> =
        core::mem::MaybeUninit::<pinocchio::account_info::AccountInfo>::uninit();
    // Create an array of uninitialized account infos.
    let mut accounts = [UNINIT; SWAP_IX_ACCOUNTS];

    let (program_id, count, instruction_data) =
        pinocchio::entrypoint::deserialize::<SWAP_IX_ACCOUNTS>(input, &mut accounts);

    let accounts = core::slice::from_raw_parts(accounts.as_ptr() as _, count);
    let result = if instruction_data.starts_with(crate::instruction::Swap::DISCRIMINATOR) {
        Some(p_handle_swap(&program_id, accounts, &instruction_data))
    } else if instruction_data.starts_with(EVENT_IX_TAG_LE) {
        Some(p_event_dispatch(&program_id, accounts, &instruction_data))
    } else {
        None
    };

    result.map(|value| match value {
        Ok(()) => solana_program::entrypoint::SUCCESS,
        Err(error) => {
            error.log();
            anchor_lang::solana_program::program_error::ProgramError::from(error).into()
        }
    })
}

/// Hot path pinocchio entrypoint with anchor fallback otherwise
#[no_mangle]
pub unsafe extern "C" fn entrypoint(input: *mut u8) -> u64 {
    match p_entrypoint(input) {
        Some(result) => result,
        None => {
            let (program_id, accounts, instruction_data) =
                unsafe { solana_program::entrypoint::deserialize(input) };

            match entry(program_id, &accounts, instruction_data) {
                Ok(()) => solana_program::entrypoint::SUCCESS,
                Err(error) => error.into(),
            }
        }
    }
}
solana_program::custom_heap_default!();
solana_program::custom_panic_default!();
