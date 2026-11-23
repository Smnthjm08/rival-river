use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

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

    #[account(mut, seeds = [b"game", game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [b"deck", game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(mut, seeds = [b"hand", game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(mut, seeds = [b"hand", game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,
}

/// Ends the lease: writes the rollup's copies of Game, Deck and both Hands
/// back to Solana, then the delegation program hands ownership back to this
/// program (via the callback `#[ephemeral]` added).
/// TODO(milestone 3, step 8): wipe the deck, unrevealed cards and secrets
/// first, or they become public on Solana.
pub fn undelegate_game_handler(ctx: Context<UndelegateGame>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.game.to_account_info(),
        ctx.accounts.deck.to_account_info(),
        ctx.accounts.hand_creator.to_account_info(),
        ctx.accounts.hand_opponent.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}
