use anchor_lang::prelude::*;

use crate::constants::GAME_SEED;
use crate::error::ErrorCode;
use crate::state::Game;

/// Runs on the rollup, after delegate_game. Placeholder for real gameplay
/// (deal, bet, showdown): proves a player can change the delegated Game and
/// that the change makes it back to Solana on undelegate.
#[derive(Accounts)]
pub struct NextHand<'info> {
    #[account(constraint = game.players.contains(&player.key()) @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,
}

pub fn next_hand_handler(ctx: Context<NextHand>) -> Result<()> {
    ctx.accounts.game.hand_number += 1;
    Ok(())
}
