use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use std::{
    cmp::{max, min},
    u64,
};

use crate::{
    activation_handler::ActivationHandler,
    base_fee::BaseFeeEnumReader,
    const_pda,
    constants::seeds::{
        POOL_PREFIX, POSITION_NFT_ACCOUNT_PREFIX, POSITION_PREFIX, TOKEN_VAULT_PREFIX,
    },
    create_position_nft, get_initial_pool_information,
    params::{activation::ActivationParams, fee_parameters::PoolFeeParameters},
    remaining_accounts::{parse_transfer_hook_accounts, AccountsType, RemainingAccountsInfo},
    safe_math::SafeCast,
    state::{fee::BaseFeeMode, Config, ConfigType, Pool, PoolType, Position, TokenBadge},
    token::{
        calculate_transfer_fee_included_amount, get_token_program_flags, transfer_from_user,
        validate_optional_token_badges, validate_token_badges,
    },
    validate_initial_sqrt_price, EvtCreatePosition, EvtInitializePool, InitialPoolInformation,
    PoolError,
};

// To fix IDL generation: https://github.com/coral-xyz/anchor/issues/3209
pub fn max_key(left: &Pubkey, right: &Pubkey) -> [u8; 32] {
    max(left, right).to_bytes()
}

pub fn min_key(left: &Pubkey, right: &Pubkey) -> [u8; 32] {
    min(left, right).to_bytes()
}

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

    /// position_nft_mint
    #[account(
        init,
        signer,
        payer = payer,
        mint::token_program = token_2022_program,
        mint::decimals = 0,
        mint::authority = pool_authority,
        mint::freeze_authority = pool, // use pool, so we can filter all position_nft_mint given pool address
        extensions::metadata_pointer::authority = pool_authority,
        extensions::metadata_pointer::metadata_address = position_nft_mint,
        extensions::close_authority::authority = pool_authority,
    )]
    pub position_nft_mint: Box<InterfaceAccount<'info, Mint>>,

    /// position nft account
    #[account(
        init,
        seeds = [POSITION_NFT_ACCOUNT_PREFIX.as_ref(), position_nft_mint.key().as_ref()],
        token::mint = position_nft_mint,
        token::authority = creator,
        token::token_program = token_2022_program,
        payer = payer,
        bump,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Which config the pool belongs to.
    pub config: AccountLoader<'info, Config>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            POOL_PREFIX.as_ref(),
            config.key().as_ref(),
            &max_key(&token_a_mint.key(), &token_b_mint.key()),
            &min_key(&token_a_mint.key(), &token_b_mint.key()),
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
            position_nft_mint.key().as_ref()
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

    /// Program to create NFT mint/token account and transfer for token22 account
    pub token_2022_program: Program<'info, Token2022>,

    // Sysvar for program account
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializePoolCtx2<'info> {
    /// CHECK: Pool creator
    pub creator: UncheckedAccount<'info>,

    /// position_nft_mint
    #[account(
        init,
        signer,
        payer = payer,
        mint::token_program = token_2022_program,
        mint::decimals = 0,
        mint::authority = pool_authority,
        mint::freeze_authority = pool, // use pool, so we can filter all position_nft_mint given pool address
        extensions::metadata_pointer::authority = pool_authority,
        extensions::metadata_pointer::metadata_address = position_nft_mint,
        extensions::close_authority::authority = pool_authority,
    )]
    pub position_nft_mint: Box<InterfaceAccount<'info, Mint>>,

    /// position nft account
    #[account(
        init,
        seeds = [POSITION_NFT_ACCOUNT_PREFIX.as_ref(), position_nft_mint.key().as_ref()],
        token::mint = position_nft_mint,
        token::authority = creator,
        token::token_program = token_2022_program,
        payer = payer,
        bump,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Address paying to create the pool. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Which config the pool belongs to.
    pub config: AccountLoader<'info, Config>,

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            POOL_PREFIX.as_ref(),
            config.key().as_ref(),
            &max_key(&token_a_mint.key(), &token_b_mint.key()),
            &min_key(&token_a_mint.key(), &token_b_mint.key()),
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
            position_nft_mint.key().as_ref()
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

    /// token badge for token a, required when token a mint is not permissionless-supported
    pub token_badge_a: Option<AccountLoader<'info, TokenBadge>>,

    /// token badge for token b, required when token b mint is not permissionless-supported
    pub token_badge_b: Option<AccountLoader<'info, TokenBadge>>,

    /// Program to create mint account and mint tokens
    pub token_a_program: Interface<'info, TokenInterface>,
    /// Program to create mint account and mint tokens
    pub token_b_program: Interface<'info, TokenInterface>,

    /// Program to create NFT mint/token account and transfer for token22 account
    pub token_2022_program: Program<'info, Token2022>,

    // Sysvar for program account
    pub system_program: Program<'info, System>,
}

/// values computed by the shared inner handler that the events need
pub struct InitializePoolResult {
    pub pool_fees: PoolFeeParameters,
    pub activation_point: u64,
    pub activation_type: u8,
    pub token_a_flag: u8,
    pub token_b_flag: u8,
    pub sqrt_price: u128,
    pub liquidity: u128,
    pub sqrt_min_price: u128,
    pub sqrt_max_price: u128,
    pub alpha_vault: Pubkey,
    pub collect_fee_mode: u8,
    pub token_a_amount: u64,
    pub token_b_amount: u64,
    pub total_amount_a: u64,
    pub total_amount_b: u64,
    pub pool_type: u8,
}

pub fn process_initialize_pool<'info>(
    ctx: Context<'info, InitializePoolCtx<'info>>,
    params: InitializePoolParameters,
) -> Result<()> {
    validate_token_badges(
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_b_mint,
        ctx.remaining_accounts,
    )?;

    let result = handle_initialize_pool(
        &ctx.accounts.creator,
        &ctx.accounts.position_nft_mint,
        &ctx.accounts.position_nft_account,
        &ctx.accounts.payer,
        &ctx.accounts.config,
        &ctx.accounts.pool_authority,
        &ctx.accounts.pool,
        &ctx.accounts.position,
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_b_mint,
        &ctx.accounts.token_a_vault,
        &ctx.accounts.token_b_vault,
        &ctx.accounts.payer_token_a,
        &ctx.accounts.payer_token_b,
        &ctx.accounts.token_a_program,
        &ctx.accounts.token_b_program,
        &ctx.accounts.token_2022_program,
        &ctx.accounts.system_program,
        None,
        None,
        params,
    )?;

    emit_cpi!(EvtCreatePosition {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.creator.key(),
        position: ctx.accounts.position.key(),
        position_nft_mint: ctx.accounts.position_nft_mint.key(),
    });

    let InitializePoolResult {
        pool_fees,
        activation_point,
        activation_type,
        token_a_flag,
        token_b_flag,
        sqrt_price,
        liquidity,
        sqrt_min_price,
        sqrt_max_price,
        alpha_vault,
        collect_fee_mode,
        token_a_amount,
        token_b_amount,
        total_amount_a,
        total_amount_b,
        pool_type,
    } = result;

    emit_cpi!(EvtInitializePool {
        pool: ctx.accounts.pool.key(),
        token_a_mint: ctx.accounts.token_a_mint.key(),
        token_b_mint: ctx.accounts.token_b_mint.key(),
        pool_fees,
        creator: ctx.accounts.creator.key(),
        payer: ctx.accounts.payer.key(),
        activation_point,
        activation_type,
        token_a_flag,
        token_b_flag,
        sqrt_price,
        liquidity,
        sqrt_min_price,
        sqrt_max_price,
        alpha_vault,
        collect_fee_mode,
        token_a_amount,
        token_b_amount,
        total_amount_a,
        total_amount_b,
        pool_type,
    });

    Ok(())
}

pub fn process_initialize_pool2<'info>(
    ctx: Context<'info, InitializePoolCtx2<'info>>,
    params: InitializePoolParameters,
    remaining_accounts_info: RemainingAccountsInfo,
) -> Result<()> {
    validate_optional_token_badges(
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_badge_a,
        &ctx.accounts.token_b_mint,
        &ctx.accounts.token_badge_b,
    )?;

    let parsed_transfer_hook_accounts = parse_transfer_hook_accounts(
        ctx.remaining_accounts,
        Some(remaining_accounts_info),
        &[AccountsType::TransferHookA, AccountsType::TransferHookB],
    )?;

    let result = handle_initialize_pool(
        &ctx.accounts.creator,
        &ctx.accounts.position_nft_mint,
        &ctx.accounts.position_nft_account,
        &ctx.accounts.payer,
        &ctx.accounts.config,
        &ctx.accounts.pool_authority,
        &ctx.accounts.pool,
        &ctx.accounts.position,
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_b_mint,
        &ctx.accounts.token_a_vault,
        &ctx.accounts.token_b_vault,
        &ctx.accounts.payer_token_a,
        &ctx.accounts.payer_token_b,
        &ctx.accounts.token_a_program,
        &ctx.accounts.token_b_program,
        &ctx.accounts.token_2022_program,
        &ctx.accounts.system_program,
        parsed_transfer_hook_accounts.transfer_hook_a,
        parsed_transfer_hook_accounts.transfer_hook_b,
        params,
    )?;

    emit_cpi!(EvtCreatePosition {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.creator.key(),
        position: ctx.accounts.position.key(),
        position_nft_mint: ctx.accounts.position_nft_mint.key(),
    });

    let InitializePoolResult {
        pool_fees,
        activation_point,
        activation_type,
        token_a_flag,
        token_b_flag,
        sqrt_price,
        liquidity,
        sqrt_min_price,
        sqrt_max_price,
        alpha_vault,
        collect_fee_mode,
        token_a_amount,
        token_b_amount,
        total_amount_a,
        total_amount_b,
        pool_type,
    } = result;

    emit_cpi!(EvtInitializePool {
        pool: ctx.accounts.pool.key(),
        token_a_mint: ctx.accounts.token_a_mint.key(),
        token_b_mint: ctx.accounts.token_b_mint.key(),
        pool_fees,
        creator: ctx.accounts.creator.key(),
        payer: ctx.accounts.payer.key(),
        activation_point,
        activation_type,
        token_a_flag,
        token_b_flag,
        sqrt_price,
        liquidity,
        sqrt_min_price,
        sqrt_max_price,
        alpha_vault,
        collect_fee_mode,
        token_a_amount,
        token_b_amount,
        total_amount_a,
        total_amount_b,
        pool_type,
    });

    Ok(())
}

fn handle_initialize_pool<'info>(
    creator: &UncheckedAccount<'info>,
    position_nft_mint: &InterfaceAccount<'info, Mint>,
    position_nft_account: &InterfaceAccount<'info, TokenAccount>,
    payer: &Signer<'info>,
    config_account: &AccountLoader<'info, Config>,
    pool_authority: &UncheckedAccount<'info>,
    pool_account: &AccountLoader<'info, Pool>,
    position_account: &AccountLoader<'info, Position>,
    token_a_mint: &InterfaceAccount<'info, Mint>,
    token_b_mint: &InterfaceAccount<'info, Mint>,
    token_a_vault: &InterfaceAccount<'info, TokenAccount>,
    token_b_vault: &InterfaceAccount<'info, TokenAccount>,
    payer_token_a: &InterfaceAccount<'info, TokenAccount>,
    payer_token_b: &InterfaceAccount<'info, TokenAccount>,
    token_a_program: &Interface<'info, TokenInterface>,
    token_b_program: &Interface<'info, TokenInterface>,
    token_2022_program: &Program<'info, Token2022>,
    system_program: &Program<'info, System>,
    transfer_hook_a: Option<&[AccountInfo<'info>]>,
    transfer_hook_b: Option<&[AccountInfo<'info>]>,
    params: InitializePoolParameters,
) -> Result<InitializePoolResult> {
    let InitializePoolParameters {
        liquidity,
        sqrt_price,
        activation_point,
    } = params;

    require!(liquidity > 0, PoolError::InvalidMinimumLiquidity);

    // init pool
    let config = config_account.load()?;

    require!(
        config.get_config_type()? == ConfigType::Static,
        PoolError::InvalidConfigType
    );

    require!(
        config.pool_fees.base_fee.get_base_fee_mode()? != BaseFeeMode::RateLimiter,
        PoolError::DeprecatedBaseFeeMode
    );

    require!(
        config.pool_creator_authority.eq(&Pubkey::default())
            || config.pool_creator_authority.eq(&payer.key()),
        PoolError::InvalidAuthorityToCreateThePool
    );

    let activation_params = ActivationParams {
        activation_point,
        activation_type: config.activation_type,
        has_alpha_vault: config.has_alpha_vault(),
    };
    activation_params.validate()?;

    let activation_point = activation_point.unwrap_or(ActivationHandler::get_current_point(
        config.activation_type,
    )?);

    validate_initial_sqrt_price(
        config.collect_fee_mode.safe_cast()?,
        sqrt_price,
        config.sqrt_min_price,
        config.sqrt_max_price,
    )?;

    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        initial_liquidity,
        sqrt_min_price,
        sqrt_max_price,
        sqrt_price,
    } = get_initial_pool_information(
        config.collect_fee_mode.safe_cast()?,
        config.sqrt_min_price,
        config.sqrt_max_price,
        sqrt_price,
        liquidity,
    )?;

    require!(
        token_a_amount > 0 || token_b_amount > 0,
        PoolError::AmountIsZero
    );
    let mut pool = pool_account.load_init()?;

    let token_a_flag: u8 = get_token_program_flags(token_a_mint).into();
    let token_b_flag: u8 = get_token_program_flags(token_b_mint).into();
    let pool_type: u8 = PoolType::Permissionless.into();

    let alpha_vault = config.get_whitelisted_alpha_vault(pool_account.key());
    pool.initialize(
        creator.key(),
        config.pool_fees.to_pool_fees_struct(sqrt_price),
        token_a_mint.key(),
        token_b_mint.key(),
        token_a_vault.key(),
        token_b_vault.key(),
        alpha_vault,
        sqrt_min_price,
        sqrt_max_price,
        sqrt_price,
        activation_point,
        config.activation_type,
        token_a_flag,
        token_b_flag,
        liquidity,
        config.collect_fee_mode,
        pool_type,
        token_a_amount,
        token_b_amount,
    );

    // init position
    let mut position = position_account.load_init()?;

    position.initialize(
        &mut pool,
        pool_account.key(),
        position_nft_mint.key(),
        initial_liquidity,
    );

    // create position nft
    drop(position);
    create_position_nft(
        payer.to_account_info(),
        position_nft_mint.to_account_info(),
        pool_authority.to_account_info(),
        system_program.to_account_info(),
        token_2022_program.to_account_info(),
        position_nft_account.to_account_info(),
    )?;

    // transfer token
    let total_amount_a = calculate_transfer_fee_included_amount(
        &token_a_mint.to_account_info().try_borrow_data()?,
        token_a_amount,
    )?
    .amount;

    let total_amount_b = calculate_transfer_fee_included_amount(
        &token_b_mint.to_account_info().try_borrow_data()?,
        token_b_amount,
    )?
    .amount;

    transfer_from_user(
        payer,
        token_a_mint,
        payer_token_a,
        token_a_vault,
        token_a_program,
        total_amount_a,
        transfer_hook_a,
    )?;
    transfer_from_user(
        payer,
        token_b_mint,
        payer_token_b,
        token_b_vault,
        token_b_program,
        total_amount_b,
        transfer_hook_b,
    )?;

    Ok(InitializePoolResult {
        pool_fees: config.pool_fees.to_pool_fee_parameters()?,
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
        token_a_amount,
        token_b_amount,
        total_amount_a,
        total_amount_b,
        pool_type,
    })
}
