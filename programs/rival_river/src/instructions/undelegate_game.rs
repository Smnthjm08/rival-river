use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::error::ErrorCode;
use crate::state::Game;

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
}

/// Ends the lease: writes the rollup's copy of Game back to Solana, then the
/// delegation program hands ownership back to this program (via the callback
/// `#[ephemeral]` added). After this, Game is unlocked on Solana again.
pub fn undelegate_game_handler(ctx: Context<UndelegateGame>) -> Result<()> {
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}
