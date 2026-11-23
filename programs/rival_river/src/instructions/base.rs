//! Instructions sent to Solana (the base layer): setup before the match,
//! and handing accounts to the rollup.
pub mod create_table;
pub mod delegate_game;
pub mod init_game;

pub use create_table::*;
pub use delegate_game::*;
pub use init_game::*;
