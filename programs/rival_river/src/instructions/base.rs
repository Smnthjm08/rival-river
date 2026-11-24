//! Instructions sent to Solana (the base layer): stakes and setup before the
//! match, handing accounts to the rollup, and paying out after it.
pub mod cancel_table;
pub mod create_table;
pub mod delegate_game;
pub mod init_game;
pub mod join_table;
pub mod refund;
pub mod settle;

pub use cancel_table::*;
pub use create_table::*;
pub use delegate_game::*;
pub use init_game::*;
pub use join_table::*;
pub use refund::*;
pub use settle::*;
