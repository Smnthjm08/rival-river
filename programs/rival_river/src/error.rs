use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Custom error message")]
    CustomError,
    #[msg("You can't invite yourself to a table")]
    OpponentIsCreator,
}
