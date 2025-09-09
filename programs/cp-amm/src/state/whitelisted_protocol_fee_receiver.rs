use anchor_lang::prelude::*;

use crate::PoolError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace)]

pub struct AdminApproval {
    pub admin: Pubkey,
    pub approved: u8,
}

#[account]
pub struct WhitelistedProtocolFeeReceiver {
    pub address: Pubkey,
    pub admin_approval_list: Vec<AdminApproval>,
}

impl WhitelistedProtocolFeeReceiver {
    pub fn space(admin_count: usize) -> usize {
        8 + // discriminator
        std::mem::size_of::<Pubkey>() + // address
        4 + (admin_count * AdminApproval::INIT_SPACE) // admin_approval_list (Vec<AdminApproval>)
    }

    pub fn init(
        &mut self,
        address: Pubkey,
        admin_list: Vec<Pubkey>,
        executing_admin: Pubkey,
    ) -> Result<()> {
        self.address = address;
        self.admin_approval_list = admin_list
            .into_iter()
            .map(|admin| AdminApproval {
                admin,
                approved: if admin.eq(&executing_admin) { 1 } else { 0 },
            })
            .collect();

        Ok(())
    }

    pub fn approve(&mut self, admin: Pubkey) -> Result<()> {
        let admin_approval = self
            .admin_approval_list
            .iter_mut()
            .find(|x| x.admin.eq(&admin))
            .ok_or(PoolError::InvalidAdmin)?;

        if admin_approval.approved == 1 {
            return Ok(());
        }

        admin_approval.approved = 1;

        Ok(())
    }

    pub fn approved(&self) -> bool {
        self.admin_approval_list.iter().all(|x| x.approved == 1)
    }
}
