use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{TABLE_SEED, USDC_MINT};
use crate::error::ErrorCode;
use crate::escrow;
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
pub fn create_table_handler(
    ctx: Context<CreateTable>,
    table_id: u64,
    opponent: Pubkey,
    stake: u64,
) -> Result<()> {
    let a = &ctx.accounts;
    require_keys_neq!(opponent, a.creator.key(), ErrorCode::OpponentIsCreator);
    require!(stake > 0, ErrorCode::ZeroStake);

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
        bump: ctx.bumps.table,
    });
    Ok(())
}
