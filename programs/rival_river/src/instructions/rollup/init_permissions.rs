use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG,
    TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::state::{Deck, Game, Hand};

/// Runs on the private rollup, after delegate_game. Creates one permission
/// per account, which decides which wallets the rollup's RPC lets read it:
///
///   Game          both players
///   Deck          nobody
///   creator Hand  creator only
///   opponent Hand opponent only
///
/// Without a permission, an account on the private rollup is public.
#[derive(Accounts)]
pub struct InitPermissions<'info> {
    #[account(mut, constraint = game.players.contains(&payer.key()) @ ErrorCode::NotAPlayer)]
    pub payer: Signer<'info>,

    #[account(mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump)]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,

    /// CHECK: permission PDA of `game` ([PERMISSION_SEED, game] under the
    /// permission program). Seeds pin the address: otherwise a player could
    /// pass an existing permission (e.g. Game's in every slot) and the loop
    /// below would skip creating the real ones, leaving those accounts public.
    #[account(mut, seeds = [PERMISSION_SEED, game.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub game_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of `deck`; same checks.
    #[account(mut, seeds = [PERMISSION_SEED, deck.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub deck_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of `hand_creator`; same checks.
    #[account(mut, seeds = [PERMISSION_SEED, hand_creator.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub hand_creator_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of `hand_opponent`; same checks.
    #[account(mut, seeds = [PERMISSION_SEED, hand_opponent.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub hand_opponent_permission: UncheckedAccount<'info>,

    /// CHECK: MagicBlock's permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: rollup vault that holds permission rent.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: MagicBlock's magic program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// A member who can read the account and see its transactions. Deliberately
/// no AUTHORITY_FLAG: players must not be able to rewrite permissions (e.g.
/// add themselves to the Deck). The accounts themselves stay the authority.
fn reader(pubkey: Pubkey) -> Member {
    Member { flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG, pubkey }
}

pub fn init_permissions_handler(ctx: Context<InitPermissions>) -> Result<()> {
    let a = &ctx.accounts;
    let game_key = a.game.key();
    let [creator, opponent] = a.game.players;

    // (account, its permission, its PDA seeds, readers)
    let game_bump = [a.game.bump];
    let deck_bump = [a.deck.bump];
    let creator_bump = [a.hand_creator.bump];
    let opponent_bump = [a.hand_opponent.bump];
    let todo: [(AccountInfo, AccountInfo, &[&[u8]], Vec<Member>); 4] = [
        (
            a.game.to_account_info(),
            a.game_permission.to_account_info(),
            &[GAME_SEED, a.game.table.as_ref(), &game_bump],
            vec![reader(creator), reader(opponent)],
        ),
        (
            a.deck.to_account_info(),
            a.deck_permission.to_account_info(),
            &[DECK_SEED, game_key.as_ref(), &deck_bump],
            vec![],
        ),
        (
            a.hand_creator.to_account_info(),
            a.hand_creator_permission.to_account_info(),
            &[HAND_SEED, game_key.as_ref(), creator.as_ref(), &creator_bump],
            vec![reader(creator)],
        ),
        (
            a.hand_opponent.to_account_info(),
            a.hand_opponent_permission.to_account_info(),
            &[HAND_SEED, game_key.as_ref(), opponent.as_ref(), &opponent_bump],
            vec![reader(opponent)],
        ),
    ];

    for (account, permission, seeds, members) in todo {
        // Idempotent: clients may retry rollup transactions.
        if permission.owner == &PERMISSION_PROGRAM_ID && !permission.data_is_empty() {
            continue;
        }
        // The account pays its own permission rent (pre-funded in init_game)
        // and signs with its PDA seeds.
        CreateEphemeralPermissionCpi {
            payer: account.clone(),
            permissioned_account: account,
            permission,
            vault: a.ephemeral_vault.to_account_info(),
            magic_program: a.magic_program.to_account_info(),
            permission_program: a.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members },
        }
        .invoke_signed(&[seeds])?;
    }
    ctx.accounts.game.permissions_ready = true;
    Ok(())
}
