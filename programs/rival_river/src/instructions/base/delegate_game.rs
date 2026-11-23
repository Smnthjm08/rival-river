use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::state::Table;

/// `#[delegate]` appends the delegation program's accounts to this struct
/// (for each `del` field X: buffer_X, delegation_record_X,
/// delegation_metadata_X; plus owner_program, delegation_program,
/// system_program) and generates a `delegate_X()` method per `del` field.
#[delegate]
#[derive(Accounts)]
pub struct DelegateGame<'info> {
    #[account(
        mut,
        constraint = payer.key() == table.creator || payer.key() == table.opponent
            @ ErrorCode::NotAPlayer,
    )]
    pub payer: Signer<'info>,

    pub table: Account<'info, Table>,

    /// CHECK: the Game PDA for this table. Seeds pin its address; `owner`
    /// makes sure init_game already ran. After this instruction the
    /// delegation program owns it on Solana and the rollup holds a copy.
    #[account(mut, del, owner = crate::ID, seeds = [GAME_SEED, table.key().as_ref()], bump)]
    pub game: UncheckedAccount<'info>,

    /// CHECK: the Deck PDA for this game; same checks as `game`.
    #[account(mut, del, owner = crate::ID, seeds = [DECK_SEED, game.key().as_ref()], bump)]
    pub deck: UncheckedAccount<'info>,

    /// CHECK: the creator's Hand PDA; same checks as `game`.
    #[account(mut, del, owner = crate::ID,
              seeds = [HAND_SEED, game.key().as_ref(), table.creator.as_ref()], bump)]
    pub hand_creator: UncheckedAccount<'info>,

    /// CHECK: the opponent's Hand PDA; same checks as `game`.
    #[account(mut, del, owner = crate::ID,
              seeds = [HAND_SEED, game.key().as_ref(), table.opponent.as_ref()], bump)]
    pub hand_opponent: UncheckedAccount<'info>,
}

/// Hands Game, Deck and both Hands to the ephemeral rollup. From here until
/// they are undelegated, all game instructions run on the rollup, not Solana.
pub fn delegate_game_handler(ctx: Context<DelegateGame>) -> Result<()> {
    let table = ctx.accounts.table.key();
    let (creator, opponent) = (ctx.accounts.table.creator, ctx.accounts.table.opponent);
    let game = ctx.accounts.game.key();
    // Optional: pin a specific rollup validator by passing it as the first
    // remaining account. None = MagicBlock picks the default.
    let validator = ctx.remaining_accounts.first().map(|a| a.key());

    ctx.accounts.delegate_game(
        &ctx.accounts.payer,
        &[GAME_SEED, table.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    ctx.accounts.delegate_deck(
        &ctx.accounts.payer,
        &[DECK_SEED, game.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    ctx.accounts.delegate_hand_creator(
        &ctx.accounts.payer,
        &[HAND_SEED, game.as_ref(), creator.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    ctx.accounts.delegate_hand_opponent(
        &ctx.accounts.payer,
        &[HAND_SEED, game.as_ref(), opponent.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}
