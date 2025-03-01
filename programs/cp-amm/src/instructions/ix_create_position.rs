use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{create, AssociatedToken, Create},
    token_2022::{self, Token2022},
};

use crate::{
    constants::seeds::{POOL_AUTHORITY_PREFIX, POSITION_PREFIX},
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

    /// CHECK: ATA address where position NFT will be minted, initialize in contract
    #[account(mut)]
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

    pub associated_token_program: Program<'info, AssociatedToken>,

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

    create_position_nft(
        &ctx.accounts.payer,
        &ctx.accounts.position_nft_mint.to_account_info(),
        &ctx.accounts.pool_authority.to_account_info(),
        &ctx.accounts.pool.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.token_program,
        &ctx.accounts.position.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.position_nft_account.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
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
    payer: &Signer<'info>,
    position_nft_mint: &AccountInfo<'info>,
    pool_authority: &AccountInfo<'info>,
    pool: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &Program<'info, Token2022>,
    position: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    position_nft_account: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    bump: u8,
) -> Result<()> {
    // create mint
    create_position_nft_mint_with_extensions(
        payer,
        position_nft_mint,
        pool_authority,
        pool, // use pool as mint close authority allow to filter all positions based on pool address
        system_program,
        token_program,
        position,
        bump,
    )?;

    // create user position nft account
    create(CpiContext::new(
        associated_token_program.clone(),
        Create {
            payer: payer.to_account_info(),
            associated_token: position_nft_account.clone(),
            authority: owner.clone(),
            mint: position_nft_mint.clone(),
            system_program: system_program.clone(),
            token_program: token_program.to_account_info(),
        },
    ))?;

    // Mint the NFT
    let seeds = pool_authority_seeds!(bump);
    token_2022::mint_to(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token_2022::MintTo {
                mint: position_nft_mint.to_account_info(),
                to: position_nft_account.to_account_info(),
                authority: pool_authority.to_account_info(),
            },
            &[&seeds[..]],
        ),
        1,
    )?;

    Ok(())
}
