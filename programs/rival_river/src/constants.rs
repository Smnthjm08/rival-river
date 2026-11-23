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
