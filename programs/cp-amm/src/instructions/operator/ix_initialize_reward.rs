use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    const_pda,
    constants::{
        seeds::REWARD_VAULT_PREFIX, MAX_REWARD_DURATION, MIN_REWARD_DURATION, NUM_REWARDS,
    },
    error::PoolError,
    event::EvtInitializeReward,
    state::{Operator, OperatorPermission, Pool, TokenBadge},
    token::{
        get_token_program_flags, is_optional_token_badge_initialized, is_supported_mint,
        is_token_badge_initialized,
    },
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u8)]
pub struct InitializeRewardCtx<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        init,
        seeds = [REWARD_VAULT_PREFIX.as_ref(), pool.key().as_ref(), reward_index.to_le_bytes().as_ref()],
        bump,
        payer = payer,
        token::mint = reward_mint,
        token::authority = pool_authority
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(reward_index: u8)]
pub struct InitializeRewardCtx2<'info> {
    /// CHECK: pool authority
    #[account(address = const_pda::pool_authority::ID)]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        init,
        seeds = [REWARD_VAULT_PREFIX.as_ref(), pool.key().as_ref(), reward_index.to_le_bytes().as_ref()],
        bump,
        payer = payer,
        token::mint = reward_mint,
        token::authority = pool_authority
    )]
    pub reward_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub reward_mint: Box<InterfaceAccount<'info, Mint>>,

    pub signer: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// token badge for the reward mint, required when it is not permissionless-supported
    pub token_badge: Option<AccountLoader<'info, TokenBadge>>,

    /// operator account, required when the signer is not the pool creator
    pub operator: Option<AccountLoader<'info, Operator>>,

    pub token_program: Interface<'info, TokenInterface>,

    pub system_program: Program<'info, System>,
}

pub fn process_initialize_reward<'info>(
    ctx: Context<'info, InitializeRewardCtx<'info>>,
    reward_index: u8,
    reward_duration: u64,
    funder: Pubkey,
) -> Result<()> {
    if !is_supported_mint(&ctx.accounts.reward_mint)? {
        require!(
            is_token_badge_initialized(
                ctx.accounts.reward_mint.key(),
                ctx.remaining_accounts
                    .get(0)
                    .ok_or(PoolError::InvalidTokenBadge)?
            )?,
            PoolError::InvalidTokenBadge
        );
    }

    handle_initialize_reward(
        &ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.reward_mint,
        &ctx.accounts.signer,
        reward_index,
        reward_duration,
        funder,
        None,
        ctx.remaining_accounts.get(1),
    )?;

    emit_cpi!(EvtInitializeReward {
        pool: ctx.accounts.pool.key(),
        reward_mint: ctx.accounts.reward_mint.key(),
        funder,
        creator: ctx.accounts.signer.key(),
        reward_duration,
        reward_index,
    });

    Ok(())
}

pub fn process_initialize_reward2<'info>(
    ctx: Context<'info, InitializeRewardCtx2<'info>>,
    reward_index: u8,
    reward_duration: u64,
    funder: Pubkey,
) -> Result<()> {
    require!(
        ctx.remaining_accounts.is_empty(),
        PoolError::InvalidRemainingAccountsLength
    );

    if !is_supported_mint(&ctx.accounts.reward_mint)? {
        require!(
            is_optional_token_badge_initialized(
                ctx.accounts.reward_mint.key(),
                &ctx.accounts.token_badge
            )?,
            PoolError::InvalidTokenBadge
        );
    }

    handle_initialize_reward(
        &ctx.accounts.pool,
        &ctx.accounts.reward_vault,
        &ctx.accounts.reward_mint,
        &ctx.accounts.signer,
        reward_index,
        reward_duration,
        funder,
        ctx.accounts.operator.as_ref(),
        None,
    )?;

    emit_cpi!(EvtInitializeReward {
        pool: ctx.accounts.pool.key(),
        reward_mint: ctx.accounts.reward_mint.key(),
        funder,
        creator: ctx.accounts.signer.key(),
        reward_duration,
        reward_index,
    });

    Ok(())
}

fn validate_operator_permission<'info>(
    operator_loader: &AccountLoader<'info, Operator>,
    signer: &Pubkey,
) -> Result<()> {
    let operator = operator_loader.load()?;
    require!(
        operator.whitelisted_address.eq(signer)
            && operator.is_permission_allow(OperatorPermission::InitializeReward),
        PoolError::InvalidAuthority
    );
    Ok(())
}

fn handle_initialize_reward<'info>(
    pool_account: &AccountLoader<'info, Pool>,
    reward_vault: &InterfaceAccount<'info, TokenAccount>,
    reward_mint: &InterfaceAccount<'info, Mint>,
    signer: &Signer<'info>,
    reward_index: u8,
    reward_duration: u64,
    funder: Pubkey,
    operator: Option<&AccountLoader<'info, Operator>>,
    legacy_operator: Option<&'info AccountInfo<'info>>,
) -> Result<()> {
    let index: usize = reward_index
        .try_into()
        .map_err(|_| PoolError::TypeCastFailed)?;

    {
        let pool = pool_account.load()?;

        require!(index < NUM_REWARDS, PoolError::InvalidRewardIndex);

        require!(
            reward_duration >= MIN_REWARD_DURATION && reward_duration <= MAX_REWARD_DURATION,
            PoolError::InvalidRewardDuration
        );

        let reward_info = &pool.reward_infos[index];
        require!(!reward_info.initialized(), PoolError::RewardInitialized);
    }

    let mut pool = pool_account.load_mut()?;

    if !pool.check_pool_creator_to_edit_reward(index, signer.key()) {
        if let Some(operator_loader) = operator {
            validate_operator_permission(operator_loader, &signer.key())?;
        } else {
            let operator_account =
                legacy_operator.ok_or_else(|| PoolError::MissingOperatorAccount)?;
            let operator_loader: AccountLoader<'info, Operator> =
                AccountLoader::try_from(operator_account)?;
            validate_operator_permission(&operator_loader, &signer.key())?;
        }
    }

    let reward_info = &mut pool.reward_infos[index];

    reward_info.init_reward(
        reward_mint.key(),
        reward_vault.key(),
        funder,
        reward_duration,
        get_token_program_flags(reward_mint).into(),
    );

    Ok(())
}
