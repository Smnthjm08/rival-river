use anchor_lang::prelude::*;

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::state::{Deck, Game, Hand, Table, TableStatus};

/// Runs on Solana. Anyone can send it: the rent goes to the creator, who paid
/// it. `refund` keeps the Table (status Refunded) while the game is still on
/// the rollup. Once undelegate_game has brought it back (allowed after the
/// deadline), this closes the Table. Game, Deck and Hands stay: see settle.
#[derive(Accounts)]
pub struct CloseRefunded<'info> {
    #[account(
        mut,
        close = creator,
        has_one = creator,
        constraint = table.status == TableStatus::Refunded @ ErrorCode::NotRefunded,
    )]
    pub table: Box<Account<'info, Table>>,

    /// `Account` checks that this program owns the Game, so this fails while
    /// it's still delegated.
    #[account(seeds = [GAME_SEED, table.key().as_ref()], bump = game.bump)]
    pub game: Box<Account<'info, Game>>,

    #[account(seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Box<Account<'info, Deck>>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Box<Account<'info, Hand>>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Box<Account<'info, Hand>>,

    #[account(mut)]
    pub creator: SystemAccount<'info>,
}

pub fn close_refunded_handler(_ctx: Context<CloseRefunded>) -> Result<()> {
    // The stakes went out in `refund`; the `close` constraint does the rest.
    Ok(())
}
