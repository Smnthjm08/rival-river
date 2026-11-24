pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

// pub use constants::*;
pub use instructions::*;
pub mod poker;

declare_id!("7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi");

/// `#[ephemeral]` adds the instruction the delegation program calls to hand
/// delegated accounts back to this program when they are undelegated.
#[ephemeral]
#[program]
pub mod rival_river {
    use super::*;

    // ---- Solana (base layer): instructions/base/ ----

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

    pub fn delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
        delegate_game::delegate_game_handler(ctx)
    }

    // ---- Private ephemeral rollup: instructions/rollup/ ----

    pub fn init_permissions(ctx: Context<InitPermissions>) -> Result<()> {
        init_permissions::init_permissions_handler(ctx)
    }

    pub fn start_hand(ctx: Context<StartHand>) -> Result<()> {
        start_hand::start_hand_handler(ctx)
    }

    pub fn act(ctx: Context<Act>, action: Action) -> Result<()> {
        act::act_handler(ctx, action)
    }

    pub fn undelegate_game(ctx: Context<UndelegateGame>) -> Result<()> {
        undelegate_game::undelegate_game_handler(ctx)
    }

    pub fn submit_secret(ctx: Context<SubmitSecret>, secret: [u8; 32]) -> Result<()> {
        submit_secret::submit_secret_handler(ctx, secret)
    }

    pub fn request_shuffle(ctx: Context<RequestShuffle>) -> Result<()> {
        request_shuffle::request_shuffle_handler(ctx)
    }

    pub fn callback_shuffle(ctx: Context<CallbackShuffle>, randomness: [u8; 32]) -> Result<()> {
        callback_shuffle::callback_shuffle_handler(ctx, randomness)
    }
}
