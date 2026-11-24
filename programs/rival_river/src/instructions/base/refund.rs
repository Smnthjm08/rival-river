use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::escrow;
use crate::state::{Game, Phase, Table, TableStatus};

/// Runs on Solana. After the deadline, anyone can return both stakes of an
/// unsettled match (init_game never ran, or the rollup never gave it back).
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
    #[account(mut, seeds = [GAME_SEED, table.key().as_ref()], bump)]
    pub game: UncheckedAccount<'info>,
    /// CHECK: the game's Deck PDA; closed with the game when it's on Solana.
    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump)]
    pub deck: UncheckedAccount<'info>,
    /// CHECK: the creator's Hand PDA; same.
    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), table.creator.as_ref()], bump)]
    pub hand_creator: UncheckedAccount<'info>,
    /// CHECK: the opponent's Hand PDA; same.
    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), table.opponent.as_ref()], bump)]
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
    require!(
        Clock::get()?.unix_timestamp > a.table.deadline,
        ErrorCode::RefundTooEarly
    );

    // A finished game back on Solana has a winner: settle it instead.
    let on_solana = a.game.owner == &crate::ID && !a.game.data_is_empty();
    if on_solana {
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
    // Close everything unless the game is still delegated: then the Table
    // stays, so its address (and the game's) can't be reused meanwhile.
    let delegated = !on_solana && !a.game.data_is_empty();
    let creator = a.creator.to_account_info();
    if !delegated {
        for acc in [&a.game, &a.deck, &a.hand_creator, &a.hand_opponent] {
            close_program_account(&acc.to_account_info(), &creator)?;
        }
    }

    ctx.accounts.table.status = TableStatus::Refunded;
    if !delegated {
        ctx.accounts.table.close(creator)?;
    }
    Ok(())
}

/// Closes an account this program owns (skips any other), rent to `to`.
fn close_program_account<'info>(acc: &AccountInfo<'info>, to: &AccountInfo<'info>) -> Result<()> {
    if acc.owner != &crate::ID {
        return Ok(());
    }
    **to.lamports.borrow_mut() += acc.lamports();
    **acc.lamports.borrow_mut() = 0;
    acc.assign(&anchor_lang::system_program::ID);
    acc.resize(0)?;
    Ok(())
}
