use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    activation_handler::{ActivationHandler, ActivationType},
    alpha_vault::alpha_vault,
    const_pda,
    constants::{
        seeds::{
            CUSTOMIZABLE_POOL_PREFIX, POSITION_NFT_ACCOUNT_PREFIX, POSITION_PREFIX,
            TOKEN_VAULT_PREFIX,
        },
        MAX_SQRT_PRICE, MIN_SQRT_PRICE,
    },
    create_position_nft, get_initial_pool_information,
    params::{activation::ActivationParams, fee_parameters::PoolFeeParameters},
    remaining_accounts::{parse_transfer_hook_accounts, AccountsType, RemainingAccountsInfo},
    safe_math::SafeCast,
    state::{CollectFeeMode, Pool, PoolType, Position, TokenBadge},
    token::{
        calculate_transfer_fee_included_amount, get_token_program_flags, transfer_from_user,
        validate_optional_token_badges, validate_token_badges,
    },
    EvtCreatePosition, EvtInitializePool, InitialPoolInformation, PoolError,
};

use super::{max_key, min_key, InitializePoolResult};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeCustomizablePoolParameters {
    /// pool fees
    pub pool_fees: PoolFeeParameters,
    /// sqrt min price
    pub sqrt_min_price: u128,
    /// sqrt max price
    pub sqrt_max_price: u128,
    /// has alpha vault
    pub has_alpha_vault: bool,
    /// initialize liquidity
    pub liquidity: u128,
    /// The init price of the pool as a sqrt(token_b/token_a) Q64.64 value. Market cap fee scheduler minimum price will be derived from this value
    pub sqrt_price: u128,
    /// activation type
    pub activation_type: u8,
    /// collect fee mode
    pub collect_fee_mode: u8,
    /// activation point
    pub activation_point: Option<u64>,
}

pub fn validate_initial_sqrt_price(
    collect_fee_mode: CollectFeeMode,
    sqrt_price: u128,
    sqrt_min_price: u128,
    sqrt_max_price: u128,
) -> Result<()> {
    if collect_fee_mode == CollectFeeMode::Compounding {
        // we still have a boundary for initial sqrt price
        require!(
            sqrt_price >= MIN_SQRT_PRICE && sqrt_price <= MAX_SQRT_PRICE,
            PoolError::InvalidPriceRange
        );
    } else {
        require!(
            sqrt_price >= sqrt_min_price && sqrt_price <= sqrt_max_price,
            PoolError::InvalidPriceRange
        );
    }
    Ok(())
}

impl InitializeCustomizablePoolParameters {
    pub fn validate(&self) -> Result<()> {
        let activation_type = ActivationType::try_from(self.activation_type)
            .map_err(|_| PoolError::InvalidActivationType)?;
        // validate fee
        let collect_fee_mode = CollectFeeMode::try_from(self.collect_fee_mode)
            .map_err(|_| PoolError::InvalidCollectFeeMode)?;

        if collect_fee_mode != CollectFeeMode::Compounding {
            // we only care for price range if collect fee mode is not Compounding
            require!(
                self.sqrt_min_price >= MIN_SQRT_PRICE && self.sqrt_max_price <= MAX_SQRT_PRICE,
                PoolError::InvalidPriceRange
            );

            require!(
                self.sqrt_min_price < self.sqrt_max_price,
                PoolError::InvalidPriceRange
            );
        }

        validate_initial_sqrt_price(
            collect_fee_mode,
            self.sqrt_price,
            self.sqrt_min_price,
            self.sqrt_max_price,
        )?;

        require!(self.liquidity > 0, PoolError::InvalidMinimumLiquidity);

        self.pool_fees.validate(collect_fee_mode, activation_type)?;

        // validate activation
        let activation_params = ActivationParams {
            activation_point: self.activation_point,
            activation_type: self.activation_type,
            has_alpha_vault: self.has_alpha_vault,
        };
        activation_params.validate()?;
        Ok(())
    }
}

#[event_cpi]
#[derive(Accounts)]
pub struct InitializeCustomizablePoolCtx<'info> {
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

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            CUSTOMIZABLE_POOL_PREFIX.as_ref(),
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
pub struct InitializeCustomizablePoolCtx2<'info> {
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

    /// CHECK: pool authority
    #[account(
        address = const_pda::pool_authority::ID
    )]
    pub pool_authority: UncheckedAccount<'info>,

    /// Initialize an account to store the pool state
    #[account(
        init,
        seeds = [
            CUSTOMIZABLE_POOL_PREFIX.as_ref(),
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

pub fn process_initialize_customizable_pool<'info>(
    ctx: Context<'info, InitializeCustomizablePoolCtx<'info>>,
    params: InitializeCustomizablePoolParameters,
) -> Result<()> {
    params.validate()?;

    validate_token_badges(
        &ctx.accounts.token_a_mint,
        &ctx.accounts.token_b_mint,
        ctx.remaining_accounts,
    )?;

    let result = handle_initialize_customizable_pool(
        &ctx.accounts.creator,
        &ctx.accounts.position_nft_mint,
        &ctx.accounts.position_nft_account,
        &ctx.accounts.payer,
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

pub fn process_initialize_customizable_pool2<'info>(
    ctx: Context<'info, InitializeCustomizablePoolCtx2<'info>>,
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

    let result = handle_initialize_customizable_pool(
        &ctx.accounts.creator,
        &ctx.accounts.position_nft_mint,
        &ctx.accounts.position_nft_account,
        &ctx.accounts.payer,
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

fn handle_initialize_customizable_pool<'info>(
    creator: &UncheckedAccount<'info>,
    position_nft_mint: &InterfaceAccount<'info, Mint>,
    position_nft_account: &InterfaceAccount<'info, TokenAccount>,
    payer: &Signer<'info>,
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

    let mut total_amount_a = calculate_transfer_fee_included_amount(
        &token_a_mint.to_account_info().try_borrow_data()?,
        token_a_amount,
    )?
    .amount;

    let mut total_amount_b = calculate_transfer_fee_included_amount(
        &token_b_mint.to_account_info().try_borrow_data()?,
        token_b_amount,
    )?
    .amount;

    // require at least 1 lamport to prove ownership of token mints
    total_amount_a = total_amount_a.max(1);
    total_amount_b = total_amount_b.max(1);

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

pub fn get_whitelisted_alpha_vault(payer: Pubkey, pool: Pubkey, has_alpha_vault: bool) -> Pubkey {
    if has_alpha_vault {
        alpha_vault::derive_vault_pubkey(payer, pool)
    } else {
        Pubkey::default()
    }
}
