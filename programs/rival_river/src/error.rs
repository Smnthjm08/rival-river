use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("You can't invite yourself to a table")]
    OpponentIsCreator,
    #[msg("Only the table's two players can do this")]
    NotAPlayer,
}
