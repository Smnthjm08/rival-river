use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{TABLE_SEED, USDC_MINT};
use crate::error::ErrorCode;
use crate::escrow;
use crate::instructions::base::init_game::game_rent;
use crate::state::{Table, TableStatus};

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Table::INIT_SPACE,
        seeds = [TABLE_SEED, creator.key().as_ref(), &table_id.to_le_bytes()],
        bump,
    )]
    pub table: Account<'info, Table>,

    /// Only USDC: any other mint could be fake, or a Token-2022 mint whose
    /// extensions let its owner drain or freeze the vault.
    #[account(address = USDC_MINT @ ErrorCode::WrongMint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = creator,
              token::token_program = token_program)]
    pub creator_token: InterfaceAccount<'info, TokenAccount>,

    /// The Table PDA's token account for `mint`. `init_if_needed`: anyone can
    /// create an ATA, so `init` would let them block this table in advance.
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = table,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Opens a table and puts the creator's stake in the vault. The invited
/// opponent matches it with join_table. Until then, cancel_table refunds it.
///
/// `opponent`: the only wallet that can join, or Pubkey::default() for an
/// open table that whoever holds the invite link can join; then
/// `invite_key` (the public half of the link's keypair) is required.
///
/// `session_key` (or Pubkey::default() for none) will sign the creator's
/// moves on the rollup. The creator also pre-pays the game accounts' rent
/// into the Table: whoever runs init_game is paid back from it, so the
/// opponent can start the match when they join without paying for it.
pub fn create_table_handler(
    ctx: Context<CreateTable>,
    table_id: u64,
    opponent: Pubkey,
    stake: u64,
    session_key: Pubkey,
    invite_key: Pubkey,
) -> Result<()> {
    let a = &ctx.accounts;
    let none = Pubkey::default();
    require_keys_neq!(opponent, a.creator.key(), ErrorCode::OpponentIsCreator);
    require!(stake > 0, ErrorCode::ZeroStake);
    require!(opponent != none || invite_key != none, ErrorCode::NoWayToJoin);
    // The other seat's wallet can't also sign for this one.
    require!(opponent == none || session_key != opponent, ErrorCode::SessionKeyTaken);

    escrow::deposit(
        &a.creator,
        &a.creator_token,
        &a.vault,
        &a.mint,
        &a.token_program,
        stake,
    )?;

    ctx.accounts.table.set_inner(Table {
        table_id,
        creator: ctx.accounts.creator.key(),
        opponent,
        mint: ctx.accounts.mint.key(),
        stake,
        status: TableStatus::WaitingForOpponent,
        deadline: 0,
        session_keys: [session_key, Pubkey::default()],
        invite_key,
        bump: ctx.bumps.table,
    });

    // Rides in the Table's lamports until init_game; cancel_table and refund
    // close the Table to the creator, so it comes back if no game starts.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.table.to_account_info(),
            },
        ),
        game_rent()?,
    )?;
    Ok(())
}
