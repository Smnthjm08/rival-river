use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

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
    #[account(mut, del, owner = crate::ID, seeds = [b"game", table.key().as_ref()], bump)]
    pub game: UncheckedAccount<'info>,

    /// CHECK: the Deck PDA for this game; same checks as `game`.
    #[account(mut, del, owner = crate::ID, seeds = [b"deck", game.key().as_ref()], bump)]
    pub deck: UncheckedAccount<'info>,
}

/// Hands Game and Deck to the ephemeral rollup. From here until they are
/// undelegated, all game instructions run on the rollup, not on Solana.
pub fn delegate_game_handler(ctx: Context<DelegateGame>) -> Result<()> {
    let table = ctx.accounts.table.key();
    let game = ctx.accounts.game.key();
    // Optional: pin a specific rollup validator by passing it as the first
    // remaining account. None = MagicBlock picks the default.
    let validator = ctx.remaining_accounts.first().map(|a| a.key());

    ctx.accounts.delegate_game(
        &ctx.accounts.payer,
        &[b"game", table.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    ctx.accounts.delegate_deck(
        &ctx.accounts.payer,
        &[b"deck", game.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}
