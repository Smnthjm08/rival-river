pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub mod poker;

declare_id!("7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi");

#[program]
pub mod rival_river {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
