//! Instructions sent to the private ephemeral rollup, on accounts that
//! delegate_game handed over. Sending them to Solana fails.
pub mod callback_shuffle;
pub mod init_permissions;
pub mod next_hand;
pub mod request_shuffle;
pub mod undelegate_game;

pub use callback_shuffle::*;
pub use init_permissions::*;
pub use next_hand::*;
pub use request_shuffle::*;
pub use undelegate_game::*;
