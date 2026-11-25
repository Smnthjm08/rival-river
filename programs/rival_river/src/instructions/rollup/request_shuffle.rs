use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::anchor::vrf;
use ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE;
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED, TURN_SECONDS};
use crate::error::ErrorCode;
use crate::state::{Deck, Game, Hand, Phase};

/// Runs on the rollup. `#[vrf]` appends program_identity, vrf_program,
/// slot_hashes and system_program, and generates `invoke_signed_vrf()`.
#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
    #[account(mut, constraint = game.seat_of(&player.key()).is_some() @ ErrorCode::NotAPlayer)]
    pub player: Signer<'info>,

    /// Only once start_hand has posted the blinds, and only once per hand:
    /// no reshuffling after seeing your hole cards.
    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump,
              constraint = game.phase == Phase::Dealing @ ErrorCode::NotDealing)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,

    /// CHECK: pinned to MagicBlock's rollup oracle queue, so a player can't
    /// route the request to an oracle they run (and know the deck in advance).
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Step 1 of 2: ask the VRF oracle for 32 random bytes. The answer arrives
/// later, in a separate transaction that calls `callback_shuffle`.
pub fn request_shuffle_handler(ctx: Context<RequestShuffle>) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.deck.pending, ErrorCode::ShufflePending);
    // Both secrets must be locked in before the VRF output exists, so nobody
    // can pick a secret after seeing anything about the deck.
    require!(
        a.hand_creator.has_secret && a.hand_opponent.has_secret,
        ErrorCode::SecretsMissing
    );

    let game = &a.game;
    let meta = |pubkey: Pubkey| SerializableAccountMeta {
        pubkey,
        is_signer: false,
        is_writable: true,
    };
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: a.player.key(),
        oracle_queue: a.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::CallbackShuffle::DISCRIMINATOR.to_vec(),
        // Part of the VRF input. Unique per game and hand so every request
        // gets a different output.
        caller_seed: solana_sha256_hasher::hashv(&[game.key().as_ref(), &[game.hand_number]])
            .to_bytes(),
        // The accounts the oracle passes to callback_shuffle, in the order of
        // its accounts struct.
        accounts_metas: Some(vec![
            meta(game.key()),
            meta(a.deck.key()),
            meta(a.hand_creator.key()),
            meta(a.hand_opponent.key()),
        ]),
        // Comes back as callback_shuffle's `hand_number`, so an answer to an
        // older request can't deal a later hand.
        callback_args: Some(vec![game.hand_number]),
        ..Default::default()
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.player.to_account_info(), &ix)?;

    // Mark the deck stale until the callback lands.
    let deck = &mut ctx.accounts.deck;
    deck.shuffled = false;
    deck.pending = true;
    // Give the oracle a full turn to answer before claim_timeout may clear
    // the request.
    ctx.accounts.game.deadline = Clock::get()?.unix_timestamp + TURN_SECONDS;
    Ok(())
}
