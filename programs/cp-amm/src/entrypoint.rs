use crate::{
    entry, p_event_dispatch, p_handle_swap, SwapParameters, SwapParameters2, SWAP_IX_ACCOUNTS,
};
use anchor_lang::{
    prelude::{event::EVENT_IX_TAG_LE, *},
    solana_program,
};

#[inline(always)]
unsafe fn p_entrypoint(input: *mut u8) -> Option<u64> {
    const UNINIT: core::mem::MaybeUninit<pinocchio::account_info::AccountInfo> =
        core::mem::MaybeUninit::<pinocchio::account_info::AccountInfo>::uninit();
    // Create an array of uninitialized account infos.
    // In rate limiter we may need an additional account for sysvar program id
    let mut accounts = [UNINIT; SWAP_IX_ACCOUNTS + 1];

    let (program_id, count, instruction_data) =
        pinocchio::entrypoint::deserialize(input, &mut accounts);

    let accounts = core::slice::from_raw_parts(accounts.as_ptr() as _, count);

    let instruction_bits = [
        instruction_data.starts_with(crate::instruction::Swap::DISCRIMINATOR),
        instruction_data.starts_with(crate::instruction::Swap2::DISCRIMINATOR),
        instruction_data.starts_with(EVENT_IX_TAG_LE),
    ];
    let result = match instruction_bits {
        [true, false, false] | [false, true, false] => {
            let (left, right) = accounts.split_at_unchecked(SWAP_IX_ACCOUNTS);
            let accounts = core::slice::from_raw_parts(left.as_ptr() as _, SWAP_IX_ACCOUNTS);
            let remaining_accounts = core::slice::from_raw_parts(
                right.as_ptr() as _,
                count.checked_sub(SWAP_IX_ACCOUNTS)?,
            );
            let params = if instruction_bits[0] {
                let swap_parameters = unwrap_or_return!(
                    SwapParameters::deserialize(&mut &instruction_data[8..]),
                    Some(ErrorCode::InstructionDidNotDeserialize as u64) // TODO test this
                );

                swap_parameters.to_swap_parameters2()
            } else {
                let swap_parameters = unwrap_or_return!(
                    SwapParameters2::deserialize(&mut &instruction_data[8..]),
                    Some(ErrorCode::InstructionDidNotDeserialize as u64) // TODO test this
                );

                swap_parameters
            };

            Some(p_handle_swap(
                &program_id,
                accounts,
                remaining_accounts,
                &params,
            ))
        }
        [false, false, true] => Some(p_event_dispatch(&program_id, accounts, &instruction_data)),
        _ => None,
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
