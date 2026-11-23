use anchor_lang::prelude::*;

use crate::constants::TABLE_SEED;
use crate::error::ErrorCode;
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

    pub system_program: Program<'info, System>,
}

/// Opens a table and records which collectible the creator will stake.
/// Nothing is escrowed yet: that happens once both players accept the stakes.
pub fn create_table_handler(
    ctx: Context<CreateTable>,
    table_id: u64,
    opponent: Pubkey,
    creator_nft: Pubkey,
) -> Result<()> {
    let creator = ctx.accounts.creator.key();
    require_keys_neq!(opponent, creator, ErrorCode::OpponentIsCreator);

    ctx.accounts.table.set_inner(Table {
        table_id,
        creator,
        opponent,
        creator_nft,
        opponent_nft: None,
        status: TableStatus::WaitingForOpponent,
        bump: ctx.bumps.table,
    });
    Ok(())
}
