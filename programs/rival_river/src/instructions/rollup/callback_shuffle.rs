use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::vrf_callback;

use crate::error::ErrorCode;
use crate::poker;
use crate::state::{Deck, Hand};

/// Called by the VRF program, never by players. `#[vrf_callback]` appends
/// `vrf_program_identity: Signer`, a key only the VRF program can sign for,
/// so nobody can call this with randomness of their own choosing.
#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    #[account(mut)]
    pub deck: Account<'info, Deck>,

    #[account(mut, constraint = hand_creator.game == deck.game @ ErrorCode::WrongHand)]
    pub hand_creator: Account<'info, Hand>,

    #[account(
        mut,
        constraint = hand_opponent.game == deck.game @ ErrorCode::WrongHand,
        constraint = hand_opponent.key() != hand_creator.key() @ ErrorCode::WrongHand,
    )]
    pub hand_opponent: Account<'info, Hand>,
}

/// Step 2 of 2: the VRF program verified the oracle's proof and hands us the
/// random bytes. Mix in both secrets, shuffle, deal two hole cards each.
/// Don't `msg!` the seed or the cards: anyone who sees them knows the deck.
pub fn callback_shuffle_handler(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.hand_creator.has_secret && a.hand_opponent.has_secret,
        ErrorCode::SecretsMissing
    );

    // The oracle knows `randomness` but neither secret; each player knows one
    // secret but not the other or `randomness`. Nobody can rebuild the deck.
    let seed = solana_sha256_hasher::hashv(&[
        &randomness,
        &a.hand_creator.secret,
        &a.hand_opponent.secret,
    ])
    .to_bytes();
    let cards = poker::shuffle(&seed);

    // Deal like a dealer: alternate, creator first.
    a.hand_creator.cards = [cards[0], cards[2]];
    a.hand_opponent.cards = [cards[1], cards[3]];
    for hand in [&mut a.hand_creator, &mut a.hand_opponent] {
        hand.dealt = true;
        // Used up: wipe so it can't leak later, and require a fresh one next hand.
        hand.secret = [0; 32];
        hand.has_secret = false;
    }

    let deck = &mut a.deck;
    deck.cards = cards;
    deck.next = 4;
    deck.shuffled = true;
    deck.pending = false;
    Ok(())
}
