use std::{cell::Ref, mem};

use anchor_lang::prelude::*;

pub fn load_account_checked<'info, T: bytemuck::Pod + Discriminator + Owner>(
    account_info: &'info anchor_lang::prelude::AccountInfo,
) -> Result<Ref<'info, T>> {
    // validate owner
    require!(
        account_info.owner.eq(&T::owner()),
        ErrorCode::AccountOwnedByWrongProgram
    );

    let data = account_info.try_borrow_data()?;
    let disc = T::DISCRIMINATOR;
    if data.len() < disc.len() {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let given_disc = &data[..disc.len()];
    if given_disc != disc {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }

    Ok(Ref::map(data, |data| {
        bytemuck::from_bytes(&data[disc.len()..mem::size_of::<T>() + disc.len()])
    }))
}
