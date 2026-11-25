use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;
use ephemeral_rollups_sdk::ephemeral_accounts::rent;

use crate::constants::{
    DECK_SEED, GAME_SEED, HAND_SEED, MATCH_SECONDS, MAX_PERMISSION_MEMBERS, STARTING_STACK,
};
use crate::error::ErrorCode;
use crate::state::{Deck, Game, Hand, Phase, Table, TableStatus};

#[derive(Accounts)]
pub struct InitGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// `has_one = creator` checks table.creator == creator.key(),
    /// so only the table's creator can open its game. Only once both stakes
    /// are in the vault.
    #[account(mut, has_one = creator,
              constraint = table.status == TableStatus::Locked @ ErrorCode::TableNotLocked)]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = creator,
        space = 8 + Game::INIT_SPACE,
        seeds = [GAME_SEED, table.key().as_ref()],
        bump,
    )]
    pub game: Account<'info, Game>,

    #[account(
        init,
        payer = creator,
        space = 8 + Deck::INIT_SPACE,
        seeds = [DECK_SEED, game.key().as_ref()],
        bump,
    )]
    pub deck: Account<'info, Deck>,

    #[account(
        init,
        payer = creator,
        space = 8 + Hand::INIT_SPACE,
        seeds = [HAND_SEED, game.key().as_ref(), table.creator.as_ref()],
        bump,
    )]
    pub hand_creator: Account<'info, Hand>,

    #[account(
        init,
        payer = creator,
        space = 8 + Hand::INIT_SPACE,
        seeds = [HAND_SEED, game.key().as_ref(), table.opponent.as_ref()],
        bump,
    )]
    pub hand_opponent: Account<'info, Hand>,

    pub system_program: Program<'info, System>,
}

/// Creates the match-state accounts on Solana. All four get delegated to the
/// rollup later; one game per table, enforced by the PDA seeds.
/// Also starts the match clock: the refund deadline is MATCH_SECONDS from now.
pub fn init_game_handler(ctx: Context<InitGame>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    // Past the start window the opponent may already be refunding: don't
    // take that way out from under them.
    require!(now <= ctx.accounts.table.deadline, ErrorCode::MatchExpired);
    ctx.accounts.table.status = TableStatus::InPlay;
    ctx.accounts.table.deadline = now + MATCH_SECONDS;
    let table = &ctx.accounts.table;
    let game_key = ctx.accounts.game.key();

    ctx.accounts.game.set_inner(Game {
        table: table.key(),
        players: [table.creator, table.opponent],
        session_keys: [Pubkey::default(); 2],
        hand_number: 0,
        permissions_ready: false,
        stacks: [STARTING_STACK; 2],
        bets: [0; 2],
        pot: 0,
        dealer: 0, // creator has the button on hand 1
        to_act: 0,
        acted: [false; 2],
        min_raise: 0,
        phase: Phase::Waiting,
        board: [0; 5],
        shown: None,
        deadline: 0,
        match_deadline: table.deadline,
        winner: None,
        bump: ctx.bumps.game,
    });
    ctx.accounts.deck.set_inner(Deck {
        game: game_key,
        cards: [0; 52],
        shuffled: false,
        pending: false,
        next: 0,
        bump: ctx.bumps.deck,
    });
    let empty_hand = |player: Pubkey, bump: u8| Hand {
        game: game_key,
        player,
        cards: [0; 2],
        dealt: false,
        secret: [0; 32],
        has_secret: false,
        bump,
    };
    ctx.accounts
        .hand_creator
        .set_inner(empty_hand(table.creator, ctx.bumps.hand_creator));
    ctx.accounts
        .hand_opponent
        .set_inner(empty_hand(table.opponent, ctx.bumps.hand_opponent));

    // On the private rollup each account pays rent for its own permission.
    // Send the lamports now; they travel with the account when delegated.
    let permission_rent = rent(EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32);
    let accounts = [
        ctx.accounts.game.to_account_info(),
        ctx.accounts.deck.to_account_info(),
        ctx.accounts.hand_creator.to_account_info(),
        ctx.accounts.hand_opponent.to_account_info(),
    ];
    for to in accounts {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to,
                },
            ),
            permission_rent,
        )?;
    }
    Ok(())
}
