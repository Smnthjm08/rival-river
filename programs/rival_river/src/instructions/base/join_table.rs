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
/// until the match is settled, or refunded if nobody starts the game within
/// START_SECONDS. The app sends init_game and delegate_game right after, in
/// the same wallet prompt.
///
/// `session_key` (or Pubkey::default() for none) will sign the opponent's
/// moves on the rollup.
pub fn join_table_handler(ctx: Context<JoinTable>, session_key: Pubkey) -> Result<()> {
    let a = &ctx.accounts;
    // A key that already signs for the creator's seat would make it
    // ambiguous whose move a signature is.
    let creator_session = a.table.session_keys[0];
    require!(
        session_key != a.table.creator
            && (session_key != creator_session || creator_session == Pubkey::default()),
        ErrorCode::SessionKeyTaken
    );
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
    table.session_keys[1] = session_key;
    Ok(())
}
