use anchor_lang::prelude::*;

use crate::constants::{BLINDS, GAME_SEED, MAX_HANDS, TURN_SECONDS};
use crate::error::ErrorCode;
use crate::state::{Game, Phase};

/// Runs on the rollup, between hands. Either player (wallet or session key)
/// can start the next hand.
#[derive(Accounts)]
pub struct StartHand<'info> {
    #[account(constraint = game.seat_of(&player.key()).is_some() @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump,
              constraint = game.phase == Phase::Waiting @ ErrorCode::HandInProgress)]
    pub game: Account<'info, Game>,
}

/// Moves the button and posts the blinds. Cards come next: both secrets,
/// request_shuffle, and callback_shuffle moves the hand to Preflop.
pub fn start_hand_handler(ctx: Context<StartHand>) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let now = Clock::get()?.unix_timestamp;
    // No new hands after the match deadline: see apply in act.rs.
    require!(now <= game.match_deadline, ErrorCode::MatchExpired);
    game.hand_number = game.hand_number.checked_add(1).ok_or(ErrorCode::MatchTooLong)?;
    // The button alternates: creator on odd hands, opponent on even.
    game.dealer = (game.hand_number - 1) % 2;
    // Sudden-death hands (7+) stay at the last level.
    let (small, big) = BLINDS[(game.hand_number.min(MAX_HANDS) - 1) as usize];

    // Heads-up: the button posts the small blind and acts first preflop.
    let sb = game.dealer as usize;
    let bb = 1 - sb;
    // A short stack posts what it has and is all-in.
    game.bets = [0; 2];
    game.bets[sb] = small.min(game.stacks[sb]);
    game.bets[bb] = big.min(game.stacks[bb]);
    game.stacks[sb] -= game.bets[sb];
    game.stacks[bb] -= game.bets[bb];

    game.pot = 0;
    game.acted = [false; 2];
    game.board = [0; 5];
    game.shown = None;
    game.min_raise = big;
    // If the small blind put them all-in, the big blind acts first.
    game.to_act = if game.stacks[sb] == 0 {
        bb as u8
    } else {
        game.dealer
    };
    game.phase = Phase::Dealing;
    game.deadline = now + TURN_SECONDS;
    Ok(())
}
