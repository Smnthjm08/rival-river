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
    pub hand_number: u8,
    pub bump: u8,
}
