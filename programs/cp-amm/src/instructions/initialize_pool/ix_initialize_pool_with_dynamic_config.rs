use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    activation_handler::ActivationHandler,
    const_pda,
    constants::seeds::{
        POOL_PREFIX, POSITION_NFT_ACCOUNT_PREFIX, POSITION_PREFIX, TOKEN_VAULT_PREFIX,
    },
    create_position_nft, get_initial_pool_information, get_whitelisted_alpha_vault,
    remaining_accounts::{parse_transfer_hook_accounts, AccountsType, RemainingAccountsInfo},
    safe_math::SafeCast,
    state::{Config, ConfigType, Pool, PoolType, Position, TokenBadge},
    token::{
        calculate_transfer_fee_included_amount, get_token_program_flags, transfer_from_user,
        validate_optional_token_badges, validate_token_badges,
    },
    EvtCreatePosition, EvtInitializePool, InitialPoolInformation,
    InitializeCustomizablePoolParameters, PoolError,
};

use super::{max_key, min_key, InitializePoolResult};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializePoolWithDynamicConfigCtx<'info> {
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

    pub pool_creator_authority: Signer<'info>,

    /// Which config the pool belongs to.
    #[account(has_one = pool_creator_authority)]
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
pub struct InitializePoolWithDynamicConfigCtx2<'info> {
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

    pub pool_creator_authority: Signer<'info>,

    /// Which config the pool belongs to.
    #[account(has_one = pool_creator_authority)]
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

pub fn process_initialize_pool_with_dynamic_config<'info>(
    ctx: Context<'info, InitializePoolWithDynamicConfigCtx<'info>>,
    params: InitializeCustomizablePoolParameters,
) -> Result<()> {
    params.validate()?;

    // deployed v1 convention: token badge a at remaining account 0, badge b at 1
    validate_token_badges(
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_b_mint,
        ctx.remaining_accounts,
    )?;

    let result = handle_initialize_pool_with_dynamic_config(
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

pub fn process_initialize_pool_with_dynamic_config2<'info>(
    ctx: Context<'info, InitializePoolWithDynamicConfigCtx2<'info>>,
    params: InitializeCustomizablePoolParameters,
    remaining_accounts_info: RemainingAccountsInfo,
) -> Result<()> {
    params.validate()?;

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

    let result = handle_initialize_pool_with_dynamic_config(
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

fn handle_initialize_pool_with_dynamic_config<'info>(
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
    params: InitializeCustomizablePoolParameters,
) -> Result<InitializePoolResult> {
    let InitializeCustomizablePoolParameters {
        pool_fees,
        liquidity,
        sqrt_price,
        activation_point,
        sqrt_min_price,
        sqrt_max_price,
        activation_type,
        collect_fee_mode,
        has_alpha_vault,
        ..
    } = params;

    // init pool
    let config = config_account.load()?;

    require!(
        config.get_config_type()? == ConfigType::Dynamic,
        PoolError::InvalidConfigType
    );

    let InitialPoolInformation {
        token_a_amount,
        token_b_amount,
        initial_liquidity,
        sqrt_min_price,
        sqrt_max_price,
        sqrt_price,
    } = get_initial_pool_information(
        collect_fee_mode.safe_cast()?,
        sqrt_min_price,
        sqrt_max_price,
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
    let activation_point =
        activation_point.unwrap_or(ActivationHandler::get_current_point(activation_type)?);
    let alpha_vault = get_whitelisted_alpha_vault(payer.key(), pool_account.key(), has_alpha_vault);
    let pool_type: u8 = PoolType::Customizable.into();

    pool.initialize(
        creator.key(),
        pool_fees.to_pool_fees_struct(sqrt_price)?,
        token_a_mint.key(),
        token_b_mint.key(),
        token_a_vault.key(),
        token_b_vault.key(),
        alpha_vault,
        sqrt_min_price,
        sqrt_max_price,
        sqrt_price,
        activation_point,
        activation_type,
        token_a_flag,
        token_b_flag,
        liquidity,
        collect_fee_mode,
        pool_type,
        token_a_amount,
        token_b_amount,
    );

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
    })
}
