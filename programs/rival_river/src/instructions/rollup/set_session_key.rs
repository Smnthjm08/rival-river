use anchor_lang::prelude::*;

use crate::constants::GAME_SEED;
use crate::error::ErrorCode;
use crate::state::Game;

/// Runs on the rollup. A player's wallet names a key the browser holds (in
/// session storage) to sign the match's moves, so the wallet isn't asked to
/// sign every action. Can be called again to replace a lost key, or with
/// Pubkey::default() to remove it. Only the wallet can: a session key can't
/// name another.
#[derive(Accounts)]
pub struct SetSessionKey<'info> {
    #[account(constraint = game.players.contains(&player.key()) @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,
}

pub fn set_session_key_handler(ctx: Context<SetSessionKey>, key: Pubkey) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let me = game.seat_of(&ctx.accounts.player.key()).ok_or(ErrorCode::NotAPlayer)?;
    // A key that already plays for the other seat (their wallet or session
    // key) would make it ambiguous whose move a signature is.
    require!(
        game.seat_of(&key).map_or(true, |seat| seat == me),
        ErrorCode::SessionKeyTaken
    );
    game.session_keys[me] = key;
    Ok(())
}
