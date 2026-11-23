use anchor_lang::prelude::*;

use crate::state::{Deck, Game, Table};

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

    #[account(
        init,
        payer = creator,
        space = 8 + Deck::INIT_SPACE,
        seeds = [b"deck", game.key().as_ref()],
        bump,
    )]
    pub deck: Account<'info, Deck>,

    pub system_program: Program<'info, System>,
}

/// Creates the match-state accounts on Solana. Both get delegated to the
/// rollup later; one game per table, enforced by the PDA seeds. Accounts
/// can't be created on the rollup, so everything it needs is created here.
pub fn init_game_handler(ctx: Context<InitGame>) -> Result<()> {
    let table = &ctx.accounts.table;
    let game_key = ctx.accounts.game.key();
    ctx.accounts.game.set_inner(Game {
        table: table.key(),
        players: [table.creator, table.opponent],
        hand_number: 0,
        bump: ctx.bumps.game,
    });
    ctx.accounts.deck.set_inner(Deck {
        game: game_key,
        cards: [0; 52],
        shuffled: false,
        bump: ctx.bumps.deck,
    });
    Ok(())
}
