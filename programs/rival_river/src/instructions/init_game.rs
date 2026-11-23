use anchor_lang::prelude::*;

use crate::state::{Game, Table};

#[derive(Accounts)]
pub struct InitGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// `has_one = creator` checks table.creator == creator.key(),
    /// so only the table's creator can open its game.
    #[account(has_one = creator)]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = creator,
        space = 8 + Game::INIT_SPACE,
        seeds = [b"game", table.key().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,

    pub system_program: Program<'info, System>,
}

/// Creates the match-state account on Solana. It gets delegated to the
/// rollup later; one game per table, enforced by the PDA seeds.
pub fn init_game_handler(ctx: Context<InitGame>) -> Result<()> {
    ctx.accounts.game.set_inner(Game {
        table: ctx.accounts.table.key(),
        hand_number: 0,
        bump: ctx.bumps.game,
    });
    Ok(())
}
