use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::error::ErrorCode;
use crate::state::Table;

/// `#[delegate]` appends the delegation program's accounts to this struct
/// (buffer_game, delegation_record_game, delegation_metadata_game,
/// owner_program, delegation_program, system_program) and generates a
/// `delegate_game()` method for the field marked `del`.
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
}

/// Hands the Game account to the ephemeral rollup. From here until it is
/// undelegated, all game instructions run on the rollup, not on Solana.
pub fn delegate_game_handler(ctx: Context<DelegateGame>) -> Result<()> {
    let table = ctx.accounts.table.key();
    ctx.accounts.delegate_game(
        &ctx.accounts.payer,
        &[b"game", table.as_ref()],
        DelegateConfig {
            // Optional: pin a specific rollup validator by passing it as the
            // first remaining account. None = MagicBlock picks the default.
            validator: ctx.remaining_accounts.first().map(|a| a.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}
