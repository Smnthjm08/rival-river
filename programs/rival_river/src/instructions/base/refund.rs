use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED, SETTLE_GRACE_SECONDS};
use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Game, Phase, Table, TableStatus};

/// Runs on Solana. After the deadline, anyone can return both stakes of an
/// unsettled match (init_game never ran, or the rollup never gave it back).
/// For a match in play, only SETTLE_GRACE_SECONDS after it: play has stopped
/// by then, and a finished match has had time to settle.
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        has_one = creator,
        has_one = mint,
        constraint = matches!(table.status, TableStatus::Locked | TableStatus::InPlay)
            @ ErrorCode::NothingToRefund,
    )]
    pub table: Box<Account<'info, Table>>,

    /// CHECK: this table's Game PDA; may be missing or delegated.
    #[account(seeds = [GAME_SEED, table.key().as_ref()], bump)]
    pub game: UncheckedAccount<'info>,
    /// CHECK: the game's Deck PDA. Never closed (see settle).
    #[account(seeds = [DECK_SEED, game.key().as_ref()], bump)]
    pub deck: UncheckedAccount<'info>,
    /// CHECK: the creator's Hand PDA; same.
    #[account(seeds = [HAND_SEED, game.key().as_ref(), table.creator.as_ref()], bump)]
    pub hand_creator: UncheckedAccount<'info>,
    /// CHECK: the opponent's Hand PDA; same.
    #[account(seeds = [HAND_SEED, game.key().as_ref(), table.opponent.as_ref()], bump)]
    pub hand_opponent: UncheckedAccount<'info>,

    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = mint, token::authority = creator,
              token::token_program = token_program)]
    pub creator_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = mint, token::token_program = token_program,
              constraint = opponent_token.owner == table.opponent @ ErrorCode::NotAPlayer)]
    pub opponent_token: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = table,
              associated_token::token_program = token_program)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub creator: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn refund_handler(ctx: Context<Refund>) -> Result<()> {
    let a = &ctx.accounts;
    let grace = if a.table.status == TableStatus::InPlay { SETTLE_GRACE_SECONDS } else { 0 };
    require!(
        Clock::get()?.unix_timestamp > a.table.deadline + grace,
        ErrorCode::RefundTooEarly
    );

    // A finished game back on Solana has a winner: settle it instead. Only
    // once this table's match started: before that, a game at this address
    // was left by an earlier table with the same id, and must not block.
    let on_solana = a.game.owner == &crate::ID && !a.game.data_is_empty();
    if on_solana && a.table.status == TableStatus::InPlay {
        let game = Game::try_deserialize(&mut &a.game.data.borrow()[..])?;
        require!(game.phase != Phase::Finished, ErrorCode::MatchFinished);
    }

    // The opponent gets the rest, which empties the vault for closing.
    let stake = a.table.stake;
    escrow::pay(
        &a.table,
        &a.vault,
        &a.mint,
        &a.creator_token,
        stake,
        &a.token_program,
    )?;
    escrow::pay(
        &a.table,
        &a.vault,
        &a.mint,
        &a.opponent_token,
        a.vault.amount - stake,
        &a.token_program,
    )?;
    escrow::close_vault(
        &a.table,
        &a.vault,
        a.creator.to_account_info(),
        &a.token_program,
    )?;
    // Close the Table, unless the game is still delegated: then it stays
    // (status Refunded) and close_refunded closes it once undelegate_game has
    // brought the game back. Game, Deck and Hands are never closed: see settle.
    let delegated = !on_solana && !a.game.data_is_empty();
    let creator = a.creator.to_account_info();

    ctx.accounts.table.status = TableStatus::Refunded;
    if !delegated {
        ctx.accounts.table.close(creator)?;
    }
    Ok(())
}
