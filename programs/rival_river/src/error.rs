use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You can't invite yourself to a table")]
    OpponentIsCreator,
    #[msg("Only the table's two players can do this")]
    NotAPlayer,
    #[msg("You already submitted a secret for this shuffle")]
    SecretAlreadySubmitted,
    #[msg("Both players must submit a secret before the shuffle")]
    SecretsMissing,
    #[msg("A shuffle is already in progress")]
    ShufflePending,
    #[msg("Hand accounts don't belong to this deck's game")]
    WrongHand,
    #[msg("Run init_permissions first: until then the rollup accounts are public")]
    PermissionsMissing,
    #[msg("A hand is already in progress")]
    HandInProgress,
    #[msg("No hand is waiting for cards: run start_hand first")]
    NotDealing,
}
