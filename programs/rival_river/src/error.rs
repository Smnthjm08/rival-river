use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You can't invite yourself to a table")]
    OpponentIsCreator,
}
