use anchor_lang::prelude::*;

/// One heads-up match between two players. Lives at the PDA
/// ["table", creator, table_id] so both players' clients can derive it.
#[account]
#[derive(InitSpace)]
pub struct Table {
    pub table_id: u64,
    pub creator: Pubkey,
    pub opponent: Pubkey,
    /// Mint of the collectible the creator stakes.
    pub creator_nft: Pubkey,
    /// Mint of the collectible the opponent stakes; set when they join.
    pub opponent_nft: Option<Pubkey>,
    pub status: TableStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TableStatus {
    /// Created; waiting for the invited player to pick their collectible.
    WaitingForOpponent,
    /// Both collectibles chosen; waiting for both to lock them in escrow.
    ReadyToLock,
    /// Collectibles in escrow; match not started.
    Locked,
    /// Match running on the ephemeral rollup.
    InPlay,
    /// Winner paid out.
    Settled,
    /// Collectibles returned to their owners.
    Refunded,
}

/// Live match state (chips, pot, cards, whose turn). Created on Solana, then
/// delegated to the rollup while hands are played. Lives at ["game", table].
/// Kept separate from `Table` so the escrow never leaves Solana.
#[account]
#[derive(InitSpace)]
pub struct Game {
    pub table: Pubkey,
    /// [creator, opponent], copied from the Table so instructions running on
    /// the rollup can check who's playing without reading the Table on Solana.
    /// Every [_; 2] below uses the same order.
    pub players: [Pubkey; 2],
    /// 0 before the first hand, 1..=6 during the match, 7+ for sudden death.
    pub hand_number: u8,
    /// Set by init_permissions. Until then every account on the private
    /// rollup is public, so no secrets (and therefore no cards) before it.
    pub permissions_ready: bool,

    // ---- Chips. Always: stacks + bets + pot == 2 * STARTING_STACK ----
    /// Chips each player has behind (not yet bet).
    pub stacks: [u16; 2],
    /// Chips each player has put in on the current street.
    pub bets: [u16; 2],
    /// Chips from finished streets of this hand.
    pub pot: u16,

    // ---- Turn order ----
    /// Index of the button. Heads-up: the button posts the small blind,
    /// acts first preflop and last on every later street.
    pub dealer: u8,
    /// Index of the player whose turn it is.
    pub to_act: u8,
    /// Who has acted on this street. A street ends once both have acted
    /// and bets are equal; a raise resets the other player's flag.
    pub acted: [bool; 2],
    /// Smallest legal raise on this street: the big blind, or the biggest
    /// raise so far if that's larger.
    pub min_raise: u16,

    pub phase: Phase,
    /// Community cards (see poker.rs). Flop = 0..3, turn = 3, river = 4.
    /// Public by design: a card here is face up.
    pub board: [u8; 5],
    /// Both players' hole cards, [creator, opponent], once a hand goes to
    /// showdown. Cleared by start_hand. Folded hands are never shown.
    pub shown: Option<[[u8; 2]; 2]>,
    /// Index of the match winner, once there is one.
    pub winner: Option<u8>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum Phase {
    /// No hand in progress: start_hand starts the next one.
    Waiting,
    /// Blinds posted; waiting for both secrets and the shuffle.
    Dealing,
    Preflop,
    Flop,
    Turn,
    River,
    /// Someone won the match; nothing more to play.
    Finished,
}

/// The shuffled deck for the current hand. Lives at ["deck", game].
/// Separate from Game so that on the private rollup it can be made readable
/// by nobody, while Game stays readable by both players.
#[account]
#[derive(InitSpace)]
pub struct Deck {
    pub game: Pubkey,
    /// Card ids (see poker.rs) in dealing order. Only meaningful once `shuffled`.
    pub cards: [u8; 52],
    /// Set by the VRF callback; cleared when a new shuffle is requested.
    pub shuffled: bool,
    /// A shuffle was requested and the VRF callback hasn't arrived yet.
    pub pending: bool,
    /// Index of the next card to deal from `cards` (hole cards use 0..4).
    pub next: u8,
    pub bump: u8,
}

/// One player's private hand. Lives at ["hand", game, player]. On the private
/// rollup only that player can read it.
#[account]
#[derive(InitSpace)]
pub struct Hand {
    pub game: Pubkey,
    pub player: Pubkey,
    /// The two hole cards (see poker.rs). Only meaningful once `dealt`.
    pub cards: [u8; 2],
    pub dealt: bool,
    /// Random bytes the player mixes into the next shuffle, so the VRF oracle
    /// alone can't know the deck. Cleared once used.
    pub secret: [u8; 32],
    pub has_secret: bool,
    pub bump: u8,
}
