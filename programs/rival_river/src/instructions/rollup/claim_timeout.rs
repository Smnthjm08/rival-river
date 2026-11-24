use anchor_lang::prelude::*;

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED, TURN_SECONDS};
use crate::error::ErrorCode;
use crate::instructions::rollup::act::{apply, fold, timeout_action};
use crate::state::{Deck, Game, Hand, Phase};

/// Runs on the rollup. Either player can send it once `game.deadline` has
/// passed, so a stalling player can't hold the match hostage.
#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(constraint = game.players.contains(&player.key()) @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    #[account(
        mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump,
        constraint = !matches!(game.phase, Phase::Waiting | Phase::Finished) @ ErrorCode::NotTimedOut,
    )]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,
}

/// Betting: to_act checks or folds. Dealing: a player missing their secret
/// forfeits; with both in, a VRF request that never came back is cleared.
pub fn claim_timeout_handler(ctx: Context<ClaimTimeout>) -> Result<()> {
    let a = ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    require!(now > a.game.deadline, ErrorCode::NotTimedOut);

    if a.game.phase != Phase::Dealing {
        let action = timeout_action(&a.game);
        return apply(
            &mut a.game,
            &a.deck,
            [&a.hand_creator, &a.hand_opponent],
            action,
        );
    }

    match (a.hand_creator.has_secret, a.hand_opponent.has_secret) {
        // The claimer is stalling too.
        (false, false) => err!(ErrorCode::SecretsMissing),
        (false, true) => {
            fold(&mut a.game, 0);
            Ok(())
        }
        (true, false) => {
            fold(&mut a.game, 1);
            Ok(())
        }
        (true, true) => {
            // Without a pending request nobody is stalling: just request it.
            require!(a.deck.pending, ErrorCode::NotTimedOut);
            // A late answer still works: whichever lands first deals.
            a.deck.pending = false;
            a.game.deadline = now + TURN_SECONDS;
            Ok(())
        }
    }
}
