use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::GAME_SEED;
use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Game, Phase, Table, TableStatus};

/// Runs on Solana, after undelegate_game. Anyone can send it: the money can
/// only go to the winner.
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        has_one = creator,
        has_one = mint,
        constraint = table.status == TableStatus::InPlay @ ErrorCode::TableNotInPlay,
    )]
    pub table: Account<'info, Table>,

    /// `Account` checks that this program owns the Game. While it's delegated
    /// the delegation program owns it, and Solana's copy is out of date, so
    /// settling fails until the game has been undelegated.
    #[account(seeds = [GAME_SEED, table.key().as_ref()], bump = game.bump,
              constraint = game.phase == Phase::Finished @ ErrorCode::MatchNotFinished)]
    pub game: Account<'info, Game>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// The winner's token account; checked against `game.winner` below.
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub winner_token: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = table,
              associated_token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,

    /// Paid for the vault, so gets its rent back.
    #[account(mut)]
    pub creator: SystemAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Pays both stakes to the match winner.
pub fn settle_handler(ctx: Context<Settle>) -> Result<()> {
    let a = &ctx.accounts;
    let winner = a.game.winner.ok_or(ErrorCode::MatchNotFinished)?;
    require_keys_eq!(a.winner_token.owner, a.game.players[winner as usize], ErrorCode::NotTheWinner);

    escrow::release(&a.table, &a.vault, &a.mint, &a.winner_token, a.creator.to_account_info(), &a.token_program)?;
    ctx.accounts.table.status = TableStatus::Settled;
    Ok(())
}
