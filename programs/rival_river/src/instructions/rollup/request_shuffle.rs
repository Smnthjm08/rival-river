use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::anchor::vrf;
use ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE;
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

use crate::constants::{DECK_SEED, GAME_SEED};
use crate::error::ErrorCode;
use crate::state::{Deck, Game};

/// Runs on the rollup. `#[vrf]` appends program_identity, vrf_program,
/// slot_hashes and system_program, and generates `invoke_signed_vrf()`.
#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
    #[account(mut, constraint = game.players.contains(&player.key()) @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    #[account(seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    /// CHECK: pinned to MagicBlock's rollup oracle queue, so a player can't
    /// route the request to an oracle they run (and know the deck in advance).
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Step 1 of 2: ask the VRF oracle for 32 random bytes. The answer arrives
/// later, in a separate transaction that calls `callback_shuffle`.
pub fn request_shuffle_handler(ctx: Context<RequestShuffle>) -> Result<()> {
    // Mark the deck stale until the callback lands.
    ctx.accounts.deck.shuffled = false;

    let game = &ctx.accounts.game;
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.player.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
        // Part of the VRF input. Unique per game and hand so every request
        // gets a different output.
        caller_seed: solana_sha256_hasher::hashv(&[game.key().as_ref(), &[game.hand_number]])
            .to_bytes(),
        // The accounts the oracle must pass to callback_shuffle.
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: ctx.accounts.deck.key(),
            is_signer: false,
            is_writable: true,
        }]),
        ..Default::default()
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.player.to_account_info(), &ix)?;
    Ok(())
}
