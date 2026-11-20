use anchor_lang::{error::ErrorCode, prelude::*, Discriminator, Owner};
use bytemuck::Pod;
use std::{cell::Ref, mem};

fn validate_discriminator_and_owner<T: Discriminator + Owner>(
    acc_info: &AccountInfo,
) -> Result<()> {
    if acc_info.owner != &T::owner() {
        return Err(Error::from(ErrorCode::AccountOwnedByWrongProgram)
            .with_pubkeys((*acc_info.owner, T::owner())));
    }

    let data = acc_info.try_borrow_data()?;
    let disc = T::DISCRIMINATOR;
    if data.len() < disc.len() {
        return Err(ErrorCode::AccountDiscriminatorNotFound.into());
    }

    let given_disc = &data[..disc.len()];
    if given_disc != disc {
        return Err(ErrorCode::AccountDiscriminatorMismatch.into());
    }
    Ok(())
}

fn load_unchecked<'a, T: Pod + Discriminator>(acc_info: &'a AccountInfo) -> Result<Ref<'a, T>> {
    let data = acc_info.try_borrow_data()?;

    Ok(Ref::map(data, |data| {
        // just panic if it is wrong
        bytemuck::from_bytes(
            &data[T::DISCRIMINATOR.len()..mem::size_of::<T>() + T::DISCRIMINATOR.len()],
        )
    }))
}

pub fn load_checked<'a, T: Pod + Discriminator + Owner>(
    acc_info: &'a AccountInfo,
) -> Result<Ref<'a, T>> {
    validate_discriminator_and_owner::<T>(acc_info)?;
    load_unchecked::<T>(acc_info)
}
