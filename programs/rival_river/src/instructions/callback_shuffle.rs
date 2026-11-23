use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::vrf_callback;

use crate::poker;
use crate::state::Deck;

/// Called by the VRF program, never by players. `#[vrf_callback]` appends
/// `vrf_program_identity: Signer`, a key only the VRF program can sign for,
/// so nobody can call this with randomness of their own choosing.
#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackShuffle<'info> {
    #[account(mut)]
    pub deck: Account<'info, Deck>,
}

/// Step 2 of 2: the VRF program verified the oracle's proof and hands us the
/// random bytes. Don't `msg!` them: anyone who sees them can rebuild the deck.
pub fn callback_shuffle_handler(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
    let deck = &mut ctx.accounts.deck;
    deck.cards = poker::shuffle(&randomness);
    deck.shuffled = true;
    Ok(())
}
