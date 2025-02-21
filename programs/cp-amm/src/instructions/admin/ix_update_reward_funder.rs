use crate::{ assert_eq_admin, EvtUpdateRewardFunder };
use crate::constants::NUM_REWARDS;
use crate::error::PoolError;
use crate::state::pool::Pool;
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct UpdateRewardFunderCtx<'info> {
    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(constraint = assert_eq_admin(admin.key()) @ PoolError::InvalidAdmin)]
    pub admin: Signer<'info>,
}

impl<'info> UpdateRewardFunderCtx<'info> {
    fn validate(&self, reward_index: usize, new_funder: Pubkey) -> Result<()> {
        require!(reward_index < NUM_REWARDS, PoolError::InvalidRewardIndex);

        let pool = self.pool.load()?;
        let reward_info = &pool.reward_infos[reward_index];

        require!(reward_info.initialized(), PoolError::RewardUninitialized);

        require!(reward_info.funder != new_funder, PoolError::IdenticalFunder);

        Ok(())
    }
}

pub fn handle_update_reward_funder(ctx: Context<UpdateRewardFunderCtx>, reward_index: u8, new_funder: Pubkey) -> Result<()> {
    let index: usize = reward_index.try_into().map_err(|_| PoolError::TypeCastFailed)?;
    ctx.accounts.validate(index, new_funder)?;

    let mut pool = ctx.accounts.pool.load_mut()?;
    let reward_info = &mut pool.reward_infos[index];

    let old_funder = reward_info.funder;
    reward_info.funder = new_funder;

    emit_cpi!(EvtUpdateRewardFunder {
        pool: ctx.accounts.pool.key(),
        reward_index,
        old_funder,
        new_funder,
    });

    Ok(())
}