pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

// pub use constants::*;
pub use instructions::*;
pub mod poker;

declare_id!("7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi");

#[program]
pub mod rival_river {
    use super::*;

    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        opponent: Pubkey,
        creator_nft: Pubkey,
    ) -> Result<()> {
        create_table::create_table_handler(ctx, table_id, opponent, creator_nft)
    }

    pub fn init_game(ctx: Context<InitGame>) -> Result<()> {
        init_game::init_game_handler(ctx)
    }
}
