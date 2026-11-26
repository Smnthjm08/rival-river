use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::START_SECONDS;
use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Table, TableStatus};

#[derive(Accounts)]
pub struct JoinTable<'info> {
    /// The named opponent, or on an open table whoever holds the invite link.
    pub opponent: Signer<'info>,

    /// Open tables only: the invite link's keypair, co-signing the join.
    pub invite: Option<Signer<'info>>,

    #[account(
        mut,
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
///
/// `stake` is what the opponent agreed to pay. The creator can cancel and
/// reopen a table at the same address, so without it a join signed for one
/// stake could pay a bigger one.
pub fn join_table_handler(ctx: Context<JoinTable>, session_key: Pubkey, stake: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(a.table.stake == stake, ErrorCode::StakeChanged);
    let none = Pubkey::default();
    let joiner = a.opponent.key();
    if a.table.opponent != none {
        // A table for a named wallet: only that wallet.
        require_keys_eq!(joiner, a.table.opponent, ErrorCode::NotAPlayer);
    } else {
        // An open table: the invite link's key must co-sign.
        let invited = a.invite.as_ref().is_some_and(|k| k.key() == a.table.invite_key);
        require!(a.table.invite_key != none && invited, ErrorCode::InviteRequired);
        require_keys_neq!(joiner, a.table.creator, ErrorCode::OpponentIsCreator);
        // The creator's session key can't take the other seat.
        require!(joiner != a.table.session_keys[0], ErrorCode::SessionKeyTaken);
    }
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
    table.opponent = joiner;
    Ok(())
}
