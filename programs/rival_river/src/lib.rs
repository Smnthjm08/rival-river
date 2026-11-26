pub mod constants;
pub mod error;
pub mod escrow;
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
        stake: u64,
        session_key: Pubkey,
    ) -> Result<()> {
        create_table::create_table_handler(ctx, table_id, opponent, stake, session_key)
    }

    pub fn join_table(ctx: Context<JoinTable>, session_key: Pubkey) -> Result<()> {
        join_table::join_table_handler(ctx, session_key)
    }

    pub fn cancel_table(ctx: Context<CancelTable>) -> Result<()> {
        cancel_table::cancel_table_handler(ctx)
    }

    pub fn init_game(ctx: Context<InitGame>) -> Result<()> {
        init_game::init_game_handler(ctx)
    }

    pub fn delegate_game(ctx: Context<DelegateGame>) -> Result<()> {
        delegate_game::delegate_game_handler(ctx)
    }

    /// After the table's deadline, if the match was never settled.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        refund::refund_handler(ctx)
    }

    /// After undelegate_game, once the match has a winner.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        settle::settle_handler(ctx)
    }

    /// After a refund that left the game on the rollup, once it's back.
    pub fn close_refunded(ctx: Context<CloseRefunded>) -> Result<()> {
        close_refunded::close_refunded_handler(ctx)
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

    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        claim_timeout::claim_timeout_handler(ctx)
    }

    pub fn undelegate_game(ctx: Context<UndelegateGame>) -> Result<()> {
        undelegate_game::undelegate_game_handler(ctx)
    }

    /// Signed by the player's wallet; the key can then sign the match's moves.
    pub fn set_session_key(ctx: Context<SetSessionKey>, key: Pubkey) -> Result<()> {
        set_session_key::set_session_key_handler(ctx, key)
    }

    pub fn submit_secret(ctx: Context<SubmitSecret>, secret: [u8; 32]) -> Result<()> {
        submit_secret::submit_secret_handler(ctx, secret)
    }

    pub fn request_shuffle(ctx: Context<RequestShuffle>) -> Result<()> {
        request_shuffle::request_shuffle_handler(ctx)
    }

    pub fn callback_shuffle(
        ctx: Context<CallbackShuffle>,
        randomness: [u8; 32],
        hand_number: u8,
    ) -> Result<()> {
        callback_shuffle::callback_shuffle_handler(ctx, randomness, hand_number)
    }
}
