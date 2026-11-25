use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::START_SECONDS;
use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Table, TableStatus};

#[derive(Accounts)]
pub struct JoinTable<'info> {
    pub opponent: Signer<'info>,

    /// `has_one = opponent`: only the invited player can join.
    #[account(
        mut,
        has_one = opponent @ ErrorCode::NotAPlayer,
        has_one = mint,
        constraint = table.status == TableStatus::WaitingForOpponent @ ErrorCode::TableNotOpen,
    )]
    pub table: Account<'info, Table>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = opponent,
              token::token_program = token_program)]
    pub opponent_token: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = table,
              associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// The opponent matches the creator's stake. Both stakes are now locked
/// until the match is settled, or refunded if the creator doesn't start the
/// game within START_SECONDS.
pub fn join_table_handler(ctx: Context<JoinTable>) -> Result<()> {
    let a = &ctx.accounts;
    escrow::deposit(
        &a.opponent,
        &a.opponent_token,
        &a.vault,
        &a.mint,
        &a.token_program,
        a.table.stake,
    )?;
    let table = &mut ctx.accounts.table;
    table.status = TableStatus::Locked;
    table.deadline = Clock::get()?.unix_timestamp + START_SECONDS;
    Ok(())
}
