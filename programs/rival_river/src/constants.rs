// constants.rs
use anchor_lang::prelude::*;

// PDA seeds. `#[constant]` also publishes them in the IDL, so clients can
// derive the same addresses without hard-coding the strings.

/// Table: [TABLE_SEED, creator, table_id (u64 LE)]
#[constant]
pub const TABLE_SEED: &[u8] = b"table";

/// Game: [GAME_SEED, table]
#[constant]
pub const GAME_SEED: &[u8] = b"game";

/// Deck: [DECK_SEED, game]
#[constant]
pub const DECK_SEED: &[u8] = b"deck";

/// Hand: [HAND_SEED, game, player]
#[constant]
pub const HAND_SEED: &[u8] = b"hand";

/// Most members any of our permissions will ever list (Game: both players).
/// Each delegated account is pre-funded for a permission this size in
/// init_game, since it pays its own permission rent on the rollup.
pub const MAX_PERMISSION_MEMBERS: usize = 2;

/// The rollup validator Game, Deck and Hands are delegated to. It must be a
/// private (TEE) validator: on any other, permissions aren't enforced and the
/// deck is public. Devnet TEE (`getIdentity` on devnet-tee.magicblock.app).
#[cfg(not(feature = "localnet"))]
pub const ER_VALIDATOR: Pubkey =
    Pubkey::from_str_const("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

/// MagicSVM's validator, for local tests. Its keypair is public, so never
/// deploy a `localnet` build.
#[cfg(feature = "localnet")]
pub const ER_VALIDATOR: Pubkey =
    Pubkey::from_str_const("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");

/// Chips each player starts the match with.
pub const STARTING_STACK: u16 = 100;

/// Hands in a match before the chip leader wins.
pub const MAX_HANDS: u8 = 6;

/// (small blind, big blind) for hands 1..=6. Sudden-death hands reuse the last level.
pub const BLINDS: [(u16, u16); MAX_HANDS as usize] =
    [(5, 10), (10, 20), (20, 40), (30, 60), (40, 80), (50, 100)];
