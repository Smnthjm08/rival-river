//! Instructions sent to the private ephemeral rollup, on accounts that
//! delegate_game handed over. Sending them to Solana fails.
pub mod act;
pub mod callback_shuffle;
pub mod claim_timeout;
pub mod init_permissions;
pub mod request_shuffle;
pub mod start_hand;
pub mod submit_secret;
pub mod undelegate_game;

pub use act::*;
pub use callback_shuffle::*;
pub use claim_timeout::*;
pub use init_permissions::*;
pub use request_shuffle::*;
pub use start_hand::*;
pub use submit_secret::*;
pub use undelegate_game::*;
