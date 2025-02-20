use crate::constants::seeds::POSITION_PREFIX;
use crate::curve::get_initialize_amounts;
use crate::params::activation::ActivationParams;
use crate::state::PoolType;
use crate::token::{
    calculate_transfer_fee_included_amount, get_token_program_flags, is_supported_mint,
    is_token_badge_initialized, transfer_from_user,
};
use crate::{
    constants::seeds::{POOL_AUTHORITY_PREFIX, POOL_PREFIX, TOKEN_VAULT_PREFIX},
    state::{Config, Pool, Position},
};
use crate::{EvtCreatePosition, EvtInitializePool, PoolError};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use std::cmp::{max, min};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializePoolParameters {
    /// initialize liquidity
    pub liquidity: u128,
    /// The init price of the pool as a sqrt(token_b/token_a) Q64.64 value
    pub sqrt_price: u128,
    /// activation point
    pub activation_point: Option<u64>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializePoolCtx<'info> {
    /// CHECK: Pool creator
    pub creator: UncheckedAccount<'info>,

    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Which config the pool belongs to.
    pub config: AccountLoader<'info, Config>,

    /// CHECK: pool authority
    #[account(
        seeds = [
            POOL_AUTHORITY_PREFIX.as_ref(),
        ],
        bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            POOL_PREFIX.as_ref(),
            config.key().as_ref(),
            max(token_a_mint.key(), token_b_mint.key()).as_ref(),
            min(token_a_mint.key(), token_b_mint.key()).as_ref(),
        ],
        bump,
        payer = payer,
        space = 8 + Pool::INIT_SPACE
    )]
    pub pool: AccountLoader<'info, Pool>,

    #[account(
        init,
        seeds = [
            POSITION_PREFIX.as_ref(),
            pool.key().as_ref(),
            creator.key().as_ref(),
        ],
        bump,
        payer = payer,
        space = 8 + Position::INIT_SPACE
    )]
    pub position: AccountLoader<'info, Position>,

    /// Token a mint
    #[account(
        constraint = token_a_mint.key() != token_b_mint.key(),
        mint::token_program = token_a_program,
    )]
    pub token_a_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token b mint
    #[account(
        mint::token_program = token_b_program,
    )]
    pub token_b_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Token a vault for the pool
    #[account(
        init,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            token_a_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        token::mint = token_a_mint,
        token::authority = pool_authority,
        token::token_program = token_a_program,
        payer = payer,
        bump,
    )]
    pub token_a_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Token b vault for the pool
    #[account(
        init,
        seeds = [
            TOKEN_VAULT_PREFIX.as_ref(),
            token_b_mint.key().as_ref(),
            pool.key().as_ref(),
        ],
        token::mint = token_b_mint,
        token::authority = pool_authority,
        token::token_program = token_b_program,
        payer = payer,
        bump,
    )]
    pub token_b_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// payer token a account
    #[account(mut)]
    pub payer_token_a: Box<InterfaceAccount<'info, TokenAccount>>,

    /// creator token b account
    #[account(mut)]
    pub payer_token_b: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Program to create mint account and mint tokens
    pub token_a_program: Interface<'info, TokenInterface>,
    /// Program to create mint account and mint tokens
    pub token_b_program: Interface<'info, TokenInterface>,
    // Sysvar for program account
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_pool<'c: 'info, 'info>(
    ctx: Context<'_, '_, 'c, 'info, InitializePoolCtx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    if !is_supported_mint(&ctx.accounts.token_a_mint)? {
        require!(
            is_token_badge_initialized(
                ctx.accounts.token_a_mint.key(),
                ctx.remaining_accounts
                    .get(0)
                    .ok_or(PoolError::InvalidTokenBadge)?,
            )?,
            PoolError::InvalidTokenBadge
        )
    }

    if !is_supported_mint(&ctx.accounts.token_b_mint)? {
        require!(
            is_token_badge_initialized(
                ctx.accounts.token_b_mint.key(),
                ctx.remaining_accounts
                    .get(1)
                    .ok_or(PoolError::InvalidTokenBadge)?,
            )?,
            PoolError::InvalidTokenBadge
        )
    }

    let InitializePoolParameters {
        liquidity,
        sqrt_price,
        activation_point,
    } = params;

    require!(liquidity > 0, PoolError::InvalidMinimumLiquidity);

    // init pool
    let config = ctx.accounts.config.load()?;

    require!(
        config.pool_creator_authority.eq(&Pubkey::default())
            || config.pool_creator_authority.eq(&ctx.accounts.payer.key()),
        PoolError::InvalidAuthorityToCreateThePool
    );

    let activation_params = ActivationParams {
        activation_point,
        activation_type: config.activation_type,
        has_alpha_vault: config.has_alpha_vault(),
    };
    activation_params.validate()?;

    let activation_point = activation_point.unwrap_or_default();

    require!(
        sqrt_price >= config.sqrt_min_price && sqrt_price <= config.sqrt_max_price,
        PoolError::InvalidPriceRange
    );

    let (token_a_amount, token_b_amount) = get_initialize_amounts(
        config.sqrt_min_price,
        config.sqrt_max_price,
        sqrt_price,
        liquidity,
    )?;

    require!(
        token_a_amount > 0 || token_b_amount > 0,
        PoolError::AmountIsZero
    );
    let mut pool = ctx.accounts.pool.load_init()?;

    let token_a_flag: u8 = get_token_program_flags(&ctx.accounts.token_a_mint).into();
    let token_b_flag: u8 = get_token_program_flags(&ctx.accounts.token_b_mint).into();
    let pool_type: u8 = PoolType::Permissionless.into();

    let alpha_vault = config.get_whitelisted_alpha_vault(ctx.accounts.pool.key());
    pool.initialize(
        config.pool_fees.to_pool_fees_struct(),
        ctx.accounts.token_a_mint.key(),
        ctx.accounts.token_b_mint.key(),
        ctx.accounts.token_a_vault.key(),
        ctx.accounts.token_b_vault.key(),
        alpha_vault,
        config.pool_creator_authority,
        config.sqrt_min_price,
        config.sqrt_max_price,
        sqrt_price,
        activation_point,
        config.activation_type,
        token_a_flag,
        token_b_flag,
        token_a_amount,
        token_b_amount,
        liquidity,
        config.collect_fee_mode,
        pool_type,
    );

    // init position
    let mut position = ctx.accounts.position.load_init()?;

    position.initialize(
        &mut pool,
        ctx.accounts.pool.key(),
        ctx.accounts.creator.key(),
        liquidity,
    )?;

    // transfer token
    let total_amount_a =
        calculate_transfer_fee_included_amount(&ctx.accounts.token_a_mint, token_a_amount)?.amount;
    let total_amount_b =
        calculate_transfer_fee_included_amount(&ctx.accounts.token_b_mint, token_b_amount)?.amount;

    transfer_from_user(
        &ctx.accounts.payer,
        &ctx.accounts.token_a_mint,
        &ctx.accounts.payer_token_a,
        &ctx.accounts.token_a_vault,
        &ctx.accounts.token_a_program,
        total_amount_a,
    )?;
    transfer_from_user(
        &ctx.accounts.payer,
        &ctx.accounts.token_b_mint,
        &ctx.accounts.payer_token_b,
        &ctx.accounts.token_b_vault,
        &ctx.accounts.token_b_program,
        total_amount_b,
    )?;

    emit_cpi!(EvtCreatePosition {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.creator.key(),
        liquidity,
    });

    emit_cpi!(EvtInitializePool {
        token_a_mint: ctx.accounts.token_a_mint.key(),
        token_b_mint: ctx.accounts.token_b_mint.key(),
        pool_fees: config.pool_fees.to_pool_fee_parameters(),
        creator: ctx.accounts.creator.key(),
        payer: ctx.accounts.payer.key(),
        activation_point,
        activation_type: config.activation_type,
        token_a_flag,
        token_b_flag,
        sqrt_price,
        liquidity,
        sqrt_min_price: config.sqrt_min_price,
        sqrt_max_price: config.sqrt_max_price,
        alpha_vault,
        collect_fee_mode: config.collect_fee_mode,
        total_amount_a,
        total_amount_b,
        pool_type,
    });

    Ok(())
}
