use anchor_lang::{
    prelude::*,
    system_program::{create_account, CreateAccount},
};
use anchor_spl::{
    token::TokenAccount,
    token_2022::{self, initialize_account3, InitializeAccount3, Token2022},
};

use crate::{
    constants::seeds::{POOL_AUTHORITY_PREFIX, POSITION_NFT_ACCOUNT_PREFIX, POSITION_PREFIX},
    get_pool_access_validator,
    state::{Pool, Position},
    token::create_position_nft_mint_with_extensions,
    EvtCreatePosition, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreatePositionCtx<'info> {
    /// CHECK: Receives the position NFT
    pub owner: UncheckedAccount<'info>,

    /// Unique token mint address, initialize in contract
    #[account(mut)]
    pub position_nft_mint: Signer<'info>,

    /// CHECK: position nft account
    #[account(
        mut,
        seeds = [POSITION_NFT_ACCOUNT_PREFIX.as_ref(), position_nft_mint.key().as_ref()],
        bump
    )]
    pub position_nft_account: UncheckedAccount<'info>,

    #[account(mut)]
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

    /// CHECK: pool authority
    #[account(seeds = [POOL_AUTHORITY_PREFIX.as_ref()], bump)]
    pub pool_authority: UncheckedAccount<'info>,

    /// Address paying to create the position. Can be anyone
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Program to create NFT mint/token account and transfer for token22 account
    pub token_program: Program<'info, Token2022>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_position(ctx: Context<CreatePositionCtx>) -> Result<()> {
    {
        let pool = ctx.accounts.pool.load()?;
        let access_validator = get_pool_access_validator(&pool)?;
        require!(
            access_validator.can_create_position(),
            PoolError::PoolDisabled
        );
    }

    // init position
    let mut position = ctx.accounts.position.load_init()?;
    let mut pool = ctx.accounts.pool.load_mut()?;

    let liquidity = 0;

    position.initialize(
        &mut pool,
        ctx.accounts.pool.key(),
        ctx.accounts.position_nft_mint.key(),
        liquidity,
    )?;

    drop(position);
    create_position_nft(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.position_nft_mint.to_account_info(),
        ctx.accounts.pool_authority.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.position.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.accounts.owner.to_account_info(),
        ctx.bumps.pool_authority,
        ctx.bumps.position_nft_account,
    )?;

    emit_cpi!(EvtCreatePosition {
        pool: ctx.accounts.pool.key(),
        owner: ctx.accounts.owner.key(),
        position: ctx.accounts.position.key(),
        position_nft_mint: ctx.accounts.position_nft_mint.key(),
    });

    Ok(())
}

pub fn create_position_nft<'info>(
    payer: AccountInfo<'info>,
    position_nft_mint: AccountInfo<'info>,
    pool_authority: AccountInfo<'info>,
    pool: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    position: AccountInfo<'info>,
    position_nft_account: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    pool_authority_bump: u8,
    position_nft_account_bump: u8,
) -> Result<()> {
    // create mint
    create_position_nft_mint_with_extensions(
        payer.clone(),
        position_nft_mint.clone(),
        pool_authority.clone(),
        pool.clone(), // use pool as mint close authority allow to filter all positions based on pool address
        system_program.clone(),
        token_program.clone(),
        position.clone(),
        pool_authority_bump,
    )?;

    // create token account
    let position_nft_account_seeds =
        position_nft_account_seeds!(position_nft_mint.key, position_nft_account_bump);
    let space = TokenAccount::LEN;
    let lamports = Rent::get()?.minimum_balance(space);
    create_account(
        CpiContext::new_with_signer(
            system_program.clone(),
            CreateAccount {
                from: payer.clone(),
                to: position_nft_account.clone(),
            },
            &[&position_nft_account_seeds[..]],
        ),
        lamports,
        space as u64,
        token_program.key,
    )?;

    // create user position nft account
    initialize_account3(CpiContext::new_with_signer(
        token_program.clone(),
        InitializeAccount3 {
            account: position_nft_account.clone(),
            mint: position_nft_mint.clone(),
            authority: owner.clone(),
        },
        &[&position_nft_account_seeds[..]],
    ))?;

    // Mint the NFT
    let pool_authority_seeds = pool_authority_seeds!(pool_authority_bump);
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            token_2022::MintTo {
                mint: position_nft_mint.clone(),
                to: position_nft_account.clone(),
                authority: pool_authority.clone(),
            },
            &[&pool_authority_seeds[..]],
        ),
        1,
    )?;

    Ok(())
}
