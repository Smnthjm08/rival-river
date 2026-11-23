use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::state::{Deck, Game, Hand};

/// Runs on the rollup. `#[commit]` appends `magic_context` and `magic_program`,
/// the accounts the rollup uses to schedule writes back to Solana.
#[commit]
#[derive(Accounts)]
pub struct UndelegateGame<'info> {
    #[account(
        mut,
        constraint = game.players.contains(&payer.key()) @ ErrorCode::NotAPlayer,
    )]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,
}

/// Ends the lease: writes the rollup's copies of Game, Deck and both Hands
/// back to Solana, then the delegation program hands ownership back to this
/// program (via the callback `#[ephemeral]` added).
pub fn undelegate_game_handler(ctx: Context<UndelegateGame>) -> Result<()> {
    let a = ctx.accounts;
    wipe_secrets(&mut a.game, &mut a.deck, &mut a.hand_creator, &mut a.hand_opponent);
    // Save the wipe into the accounts' bytes now. Anchor normally does this
    // when the instruction returns, but the commit below may read the bytes
    // during the call, and would then send the unwiped data.
    a.game.exit(&crate::ID)?;
    a.deck.exit(&crate::ID)?;
    a.hand_creator.exit(&crate::ID)?;
    a.hand_opponent.exit(&crate::ID)?;

    MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        a.game.to_account_info(),
        a.deck.to_account_info(),
        a.hand_creator.to_account_info(),
        a.hand_opponent.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

/// Solana is public: anything committed there can be read by anyone. Clear
/// every card nobody has seen and every unused secret before it leaves the rollup.
fn wipe_secrets(game: &mut Game, deck: &mut Deck, creator: &mut Hand, opponent: &mut Hand) {
    // The deck order reveals every undealt card (and both players' hands).
    deck.cards = [0; 52];
    deck.next = 0;
    deck.shuffled = false;
    // A VRF answer still on its way can't land once the deck is back on
    // Solana; without this, request_shuffle would refuse forever.
    deck.pending = false;

    for hand in [creator, opponent] {
        hand.cards = [0; 2];
        hand.dealt = false;
        // A secret submitted for a shuffle that never ran.
        hand.secret = [0; 32];
        hand.has_secret = false;
    }

    // Permissions live only on the rollup. Make the next delegation run
    // init_permissions again before anyone can submit a secret.
    game.permissions_ready = false;
}
