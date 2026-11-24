use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Table, TableStatus};

#[derive(Accounts)]
pub struct CancelTable<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// Only before the opponent joins: after that, both stakes are locked.
    #[account(
        mut,
        has_one = creator,
        has_one = mint,
        constraint = table.status == TableStatus::WaitingForOpponent @ ErrorCode::TableNotOpen,
    )]
    pub table: Account<'info, Table>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::authority = creator,
              token::token_program = token_program)]
    pub creator_token: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = table,
              associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// The creator takes their stake back (and the vault's rent).
pub fn cancel_table_handler(ctx: Context<CancelTable>) -> Result<()> {
    let a = &ctx.accounts;
    escrow::release(
        &a.table,
        &a.vault,
        &a.mint,
        &a.creator_token,
        a.creator.to_account_info(),
        &a.token_program,
    )?;
    ctx.accounts.table.status = TableStatus::Refunded;
    Ok(())
}
