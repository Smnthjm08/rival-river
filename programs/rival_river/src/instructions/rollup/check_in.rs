use anchor_lang::prelude::*;

use crate::constants::GAME_SEED;
use crate::error::ErrorCode;
use crate::state::Game;

/// Runs on the rollup, before hand 1. Each player (wallet or session key)
/// says their client is at the table. start_hand needs both: otherwise the
/// player who is there could start hands and claim timeouts against one who
/// closed the tab after staking. If someone never checks in, no hand is
/// played and the stakes are refunded after the match deadline.
#[derive(Accounts)]
pub struct CheckIn<'info> {
    pub player: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,
}

/// Safe to send twice.
pub fn check_in_handler(ctx: Context<CheckIn>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let me = game.seat_of(&ctx.accounts.player.key()).ok_or(ErrorCode::NotAPlayer)?;
    game.checked_in[me] = true;
    Ok(())
}
