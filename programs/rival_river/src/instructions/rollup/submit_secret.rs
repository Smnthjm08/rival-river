use anchor_lang::prelude::*;

use crate::constants::{GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::state::{Game, Hand};

/// Runs on the private rollup. A player stores 32 random bytes in their own
/// Hand. The next shuffle mixes both players' secrets with the VRF output,
/// so neither the oracle nor either player alone can work out the deck.
#[derive(Accounts)]
pub struct SubmitSecret<'info> {
    #[account(constraint = game.players.contains(&player.key()) @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    #[account(seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    /// Seeds include the signer's key, so a player can only write their own Hand.
    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), player.key().as_ref()],
              bump = hand.bump)]
    pub hand: Account<'info, Hand>,
}

/// The secret should come from the client's secure random generator
/// (e.g. crypto.getRandomValues). Only this player can read their Hand, and
/// only they can see this transaction on the private rollup.
pub fn submit_secret_handler(ctx: Context<SubmitSecret>, secret: [u8; 32]) -> Result<()> {
    let hand = &mut ctx.accounts.hand;
    // One secret per shuffle: no changing it once submitted. Cleared by the
    // shuffle callback.
    require!(!hand.has_secret, ErrorCode::SecretAlreadySubmitted);
    hand.secret = secret;
    hand.has_secret = true;
    Ok(())
}
