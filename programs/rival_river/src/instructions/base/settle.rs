use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Deck, Game, Hand, Phase, Table, TableStatus};

/// Runs on Solana, after undelegate_game. Anyone can send it: the money can
/// only go to the winner.
/// Boxed: unboxed, these accounts overflow the 4 KB stack frame.
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        close = creator,
        has_one = creator,
        has_one = mint,
        constraint = table.status == TableStatus::InPlay @ ErrorCode::TableNotInPlay,
    )]
    pub table: Box<Account<'info, Table>>,

    /// `Account` checks that this program owns the Game. While it's delegated
    /// the delegation program owns it, and Solana's copy is out of date, so
    /// settling fails until the game has been undelegated.
    ///
    /// Game, Deck and Hands are never closed, so their rent stays in them.
    /// On devnet, the match's transactions (with both players' secrets) became
    /// readable by anyone on the private rollup once settle closed these
    /// accounts. scripts/smoke-devnet.ts check (e) covers it.
    #[account(seeds = [GAME_SEED, table.key().as_ref()], bump = game.bump,
              constraint = game.phase == Phase::Finished @ ErrorCode::MatchNotFinished)]
    pub game: Box<Account<'info, Game>>,

    #[account(seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Box<Account<'info, Deck>>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Box<Account<'info, Hand>>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Box<Account<'info, Hand>>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The winner's token account; checked against `game.winner` below.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub winner_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = table,
              associated_token::token_program = token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Paid for the table and vault, so gets their rent back.
    #[account(mut)]
    pub creator: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Pays both stakes to the match winner.
pub fn settle_handler(ctx: Context<Settle>) -> Result<()> {
    let a = &ctx.accounts;
    let winner = a.game.winner.ok_or(ErrorCode::MatchNotFinished)?;
    require_keys_eq!(
        a.winner_token.owner,
        a.game.players[winner as usize],
        ErrorCode::NotTheWinner
    );

    escrow::release(
        &a.table,
        &a.vault,
        &a.mint,
        &a.winner_token,
        a.creator.to_account_info(),
        &a.token_program,
    )?;
    ctx.accounts.table.status = TableStatus::Settled;
    Ok(())
}
