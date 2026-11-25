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
    #[msg("No betting round is in progress")]
    NotBetting,
    #[msg("It's the other player's turn")]
    NotYourTurn,
    #[msg("There's a bet to call: call, raise or fold")]
    CannotCheck,
    #[msg("Nothing to call: check or bet")]
    NothingToCall,
    #[msg("Raise must be at least the big blind or the last raise, unless all-in")]
    RaiseTooSmall,
    #[msg("Not enough chips for that bet")]
    NotEnoughChips,
    #[msg("Your opponent is all-in: call or fold")]
    OpponentAllIn,
    #[msg("Stake must be more than zero")]
    ZeroStake,
    #[msg("This table isn't waiting for an opponent")]
    TableNotOpen,
    #[msg("Both players must stake before the game starts")]
    TableNotLocked,
    #[msg("This table has no match in play")]
    TableNotInPlay,
    #[msg("The match isn't finished")]
    MatchNotFinished,
    #[msg("Winnings can only go to the winner's token account")]
    NotTheWinner,
    #[msg("No shuffle was requested")]
    NoShufflePending,
    #[msg("This randomness was requested for a different hand")]
    StaleShuffle,
    #[msg("The match is over: settle it instead")]
    MatchFinished,
    #[msg("The deadline hasn't passed yet")]
    NotTimedOut,
    #[msg("The refund deadline hasn't passed yet")]
    RefundTooEarly,
    #[msg("Nothing to refund: the table was never joined, or is already settled or refunded")]
    NothingToRefund,
    #[msg("Stakes must be in USDC")]
    WrongMint,
    #[msg("Too many sudden-death hands: wait for the refund deadline")]
    MatchTooLong,
    #[msg("The deadline has passed: refund the table instead")]
    MatchExpired,
    #[msg("Only a refunded table can be closed this way")]
    NotRefunded,
    #[msg("That key already plays in this game")]
    SessionKeyTaken,
}
