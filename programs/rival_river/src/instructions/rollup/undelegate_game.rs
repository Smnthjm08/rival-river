use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CloseEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::PERMISSION_SEED;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::{DECK_SEED, GAME_SEED, HAND_SEED};
use crate::error::ErrorCode;
use crate::instructions::rollup::act::end_hand;
use crate::state::{Deck, Game, Hand, Phase};

/// Runs on the rollup. `#[commit]` appends `magic_context` and `magic_program`,
/// the accounts the rollup uses to schedule writes back to Solana.
#[commit]
#[derive(Accounts)]
pub struct UndelegateGame<'info> {
    #[account(
        mut,
        constraint = game.players.contains(&payer.key()) @ ErrorCode::NotAPlayer,
    )]
    pub payer: Signer<'info>,

    /// Only while no cards are live. Mid-hand, undelegating calls the hand
    /// off and returns everyone's chips, so a player who is behind could use
    /// it instead of folding. In Dealing nobody has seen a card yet, and
    /// leaving is the way out of a VRF answer that never arrives.
    #[account(
        mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump,
        constraint = matches!(game.phase, Phase::Waiting | Phase::Dealing | Phase::Finished)
            @ ErrorCode::HandInProgress,
    )]
    pub game: Account<'info, Game>,

    #[account(mut, seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(mut, seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,

    /// CHECK: permission PDA of `game`.
    #[account(mut, seeds = [PERMISSION_SEED, game.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub game_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of `deck`.
    #[account(mut, seeds = [PERMISSION_SEED, deck.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub deck_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of `hand_creator`.
    #[account(mut, seeds = [PERMISSION_SEED, hand_creator.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub hand_creator_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of `hand_opponent`.
    #[account(mut, seeds = [PERMISSION_SEED, hand_opponent.key().as_ref()], bump,
              seeds::program = PERMISSION_PROGRAM_ID)]
    pub hand_opponent_permission: UncheckedAccount<'info>,

    /// CHECK: MagicBlock's permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: rollup vault that holds permission rent.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
}

/// Ends the lease: writes the rollup's copies of Game, Deck and both Hands
/// back to Solana, then the delegation program hands ownership back to this
/// program (via the callback `#[ephemeral]` added).
pub fn undelegate_game_handler(ctx: Context<UndelegateGame>) -> Result<()> {
    let a = ctx.accounts;
    wipe_secrets(
        &mut a.game,
        &mut a.deck,
        &mut a.hand_creator,
        &mut a.hand_opponent,
    );
    // Save the wipe into the accounts' bytes now. Anchor normally does this
    // when the instruction returns, but the commit below may read the bytes
    // during the call, and would then send the unwiped data.
    a.game.exit(&crate::ID)?;
    a.deck.exit(&crate::ID)?;
    a.hand_creator.exit(&crate::ID)?;
    a.hand_opponent.exit(&crate::ID)?;

    close_permissions(a)?;

    MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        a.game.to_account_info(),
        a.deck.to_account_info(),
        a.hand_creator.to_account_info(),
        a.hand_opponent.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

/// Refunds each permission's rent to its account, so a later delegation can
/// pay for new ones. Must run after the wipe: without its permission an
/// account is public.
fn close_permissions(a: &UndelegateGame) -> Result<()> {
    let game_key = a.game.key();
    let [creator, opponent] = a.game.players;
    let game_bump = [a.game.bump];
    let deck_bump = [a.deck.bump];
    let creator_bump = [a.hand_creator.bump];
    let opponent_bump = [a.hand_opponent.bump];
    let todo: [(AccountInfo, AccountInfo, &[&[u8]]); 4] = [
        (
            a.game.to_account_info(),
            a.game_permission.to_account_info(),
            &[GAME_SEED, a.game.table.as_ref(), &game_bump],
        ),
        (
            a.deck.to_account_info(),
            a.deck_permission.to_account_info(),
            &[DECK_SEED, game_key.as_ref(), &deck_bump],
        ),
        (
            a.hand_creator.to_account_info(),
            a.hand_creator_permission.to_account_info(),
            &[
                HAND_SEED,
                game_key.as_ref(),
                creator.as_ref(),
                &creator_bump,
            ],
        ),
        (
            a.hand_opponent.to_account_info(),
            a.hand_opponent_permission.to_account_info(),
            &[
                HAND_SEED,
                game_key.as_ref(),
                opponent.as_ref(),
                &opponent_bump,
            ],
        ),
    ];
    for (account, permission, seeds) in todo {
        if permission.owner != &PERMISSION_PROGRAM_ID || permission.data_is_empty() {
            continue;
        }
        CloseEphemeralPermissionCpi {
            payer: account.clone(),
            permissioned_account: account.clone(),
            permission,
            authority: account,
            vault: a.ephemeral_vault.to_account_info(),
            magic_program: a.magic_program.to_account_info(),
            permission_program: a.permission_program.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[seeds])?;
    }
    Ok(())
}

/// Solana is public: anything committed there can be read by anyone. Clear
/// every card nobody has seen and every unused secret before it leaves the rollup,
/// and call off any hand in progress (it can't finish without its cards).
fn wipe_secrets(game: &mut Game, deck: &mut Deck, creator: &mut Hand, opponent: &mut Hand) {
    // The deck order reveals every undealt card (and both players' hands).
    deck.cards = [0; 52];
    deck.next = 0;
    deck.shuffled = false;
    // A VRF answer still on its way can't land once the deck is back on
    // Solana; without this, request_shuffle would refuse forever.
    deck.pending = false;

    for hand in [creator, opponent] {
        hand.cards = [0; 2];
        hand.dealt = false;
        // A secret submitted for a shuffle that never ran.
        hand.secret = [0; 32];
        hand.has_secret = false;
    }

    // Undelegating while Dealing (blinds posted, no cards yet): call the hand
    // off and give back the blinds. It still counts, so after hand 6 the chip
    // leader wins as usual, and the next VRF caller_seed is new.
    if !matches!(game.phase, Phase::Waiting | Phase::Finished) {
        for i in 0..2 {
            game.stacks[i] += game.bets[i] + game.pot / 2;
        }
        game.pot = 0;
        game.bets = [0; 2];
        end_hand(game);
    }

    // Permissions are closed below. Make the next delegation run
    // init_permissions again before anyone can submit a secret.
    game.permissions_ready = false;
}
