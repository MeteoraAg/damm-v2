use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::{self, Token2022},
    token_interface::{token_metadata_initialize, Mint, TokenAccount, TokenMetadataInitialize},
};

use crate::{
    constants::seeds::{POOL_AUTHORITY_PREFIX, POSITION_NFT_ACCOUNT_PREFIX, POSITION_PREFIX},
    get_pool_access_validator,
    state::{Pool, Position},
    token::update_account_lamports_to_minimum_balance,
    EvtCreatePosition, PoolError,
};

#[event_cpi]
#[derive(Accounts)]
pub struct CreatePositionCtx<'info> {
    /// CHECK: Receives the position NFT
    pub owner: UncheckedAccount<'info>,

    /// position_nft_mint
    #[account(
        init,
        signer,
        payer = payer,
        mint::token_program = token_program,
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
        token::authority = owner,
        token::token_program = token_program,
        payer = payer,
        bump,
    )]
    pub position_nft_account: Box<InterfaceAccount<'info, TokenAccount>>,

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
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.position_nft_account.to_account_info(),
        ctx.bumps.pool_authority,
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
    system_program: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    position_nft_account: AccountInfo<'info>,
    pool_authority_bump: u8,
) -> Result<()> {
    // init token metadata
    let seeds = pool_authority_seeds!(pool_authority_bump);
    let signer_seeds = &[&seeds[..]];
    let cpi_accounts = TokenMetadataInitialize {
        program_id: token_program.clone(),
        mint: position_nft_mint.clone(),
        metadata: position_nft_mint.clone(),
        mint_authority: pool_authority.clone(),
        update_authority: pool_authority.clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program.clone(), cpi_accounts, signer_seeds);
    token_metadata_initialize(
        cpi_ctx,
        String::from("Meteora Position NFT"), // TODO do we need to allow user to input custom name?
        String::from("MPN"),
        String::from("https://raw.githubusercontent.com/MeteoraAg/token-metadata/main/meteora_position_nft.png"), // TODO update image
    )?;

    // transfer minimum rent to mint account
    update_account_lamports_to_minimum_balance(
        position_nft_mint.clone(),
        payer.clone(),
        system_program.clone(),
    )?;

    // Mint the NFT
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_program.clone(),
            token_2022::MintTo {
                mint: position_nft_mint.clone(),
                to: position_nft_account.clone(),
                authority: pool_authority.clone(),
            },
            &[&seeds[..]],
        ),
        1,
    )?;

    Ok(())
}
