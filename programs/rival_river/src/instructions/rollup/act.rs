use anchor_lang::prelude::*;

use crate::constants::{BLINDS, DECK_SEED, GAME_SEED, HAND_SEED, MAX_HANDS};
use crate::error::ErrorCode;
use crate::poker;
use crate::state::{Deck, Game, Hand, Phase};

/// What the player whose turn it is wants to do.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Fold,
    /// Only when there's nothing to call.
    Check,
    /// Match the other player's bet, or go all-in if you can't.
    Call,
    /// Bet (nothing to call) or raise, so that your bet this street totals `to`.
    Raise { to: u16 },
}

/// Runs on the rollup during a betting round. Takes the deck to deal the
/// board, and both hands for the showdown: the program can read them, even
/// though neither player can read the other's.
#[derive(Accounts)]
pub struct Act<'info> {
    pub player: Signer<'info>,

    #[account(
        mut, seeds = [GAME_SEED, game.table.as_ref()], bump = game.bump,
        constraint = matches!(game.phase, Phase::Preflop | Phase::Flop | Phase::Turn | Phase::River)
            @ ErrorCode::NotBetting,
        constraint = game.players[game.to_act as usize] == player.key() @ ErrorCode::NotYourTurn,
    )]
    pub game: Account<'info, Game>,

    #[account(seeds = [DECK_SEED, game.key().as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[0].as_ref()],
              bump = hand_creator.bump)]
    pub hand_creator: Account<'info, Hand>,

    #[account(seeds = [HAND_SEED, game.key().as_ref(), game.players[1].as_ref()],
              bump = hand_opponent.bump)]
    pub hand_opponent: Account<'info, Hand>,
}

pub fn act_handler(ctx: Context<Act>, action: Action) -> Result<()> {
    let a = ctx.accounts;
    let game = &mut a.game;
    let me = game.to_act as usize;
    let other = 1 - me;
    let to_call = game.bets[other].saturating_sub(game.bets[me]);

    match action {
        Action::Fold => {
            // The other player takes everything in the middle, their own bet included.
            game.stacks[other] += game.pot + game.bets[0] + game.bets[1];
            end_hand(game);
            return Ok(());
        }
        Action::Check => require!(to_call == 0, ErrorCode::CannotCheck),
        Action::Call => {
            require!(to_call > 0, ErrorCode::NothingToCall);
            // Short? Then it's all-in; end_street hands back what wasn't matched.
            let amount = to_call.min(game.stacks[me]);
            put_in(game, me, amount);
        }
        Action::Raise { to } => {
            require!(game.stacks[other] > 0, ErrorCode::OpponentAllIn);
            require!(to > game.bets[other], ErrorCode::RaiseTooSmall);
            let cost = to - game.bets[me];
            require!(cost <= game.stacks[me], ErrorCode::NotEnoughChips);
            // A raise must be at least as big as the last one (or the big
            // blind), unless it's all the chips you have.
            let raise_by = to - game.bets[other];
            require!(
                raise_by >= game.min_raise || cost == game.stacks[me],
                ErrorCode::RaiseTooSmall
            );
            game.min_raise = game.min_raise.max(raise_by);
            put_in(game, me, cost);
            // A raise gives the other player a new decision.
            game.acted[other] = false;
        }
    }
    game.acted[me] = true;

    if street_over(game) {
        end_street(game, &a.deck, [&a.hand_creator, &a.hand_opponent]);
    } else {
        game.to_act = other as u8;
    }
    Ok(())
}

fn put_in(game: &mut Game, player: usize, amount: u16) {
    game.stacks[player] -= amount;
    game.bets[player] += amount;
}

/// Over once each player is either all-in (can't act) or has acted and
/// matched the biggest bet.
fn street_over(game: &Game) -> bool {
    let max = game.bets[0].max(game.bets[1]);
    (0..2).all(|i| game.stacks[i] == 0 || (game.acted[i] && game.bets[i] == max))
}

fn end_street(game: &mut Game, deck: &Deck, hands: [&Hand; 2]) {
    // Heads-up has no side pots: chips the other player couldn't match go
    // straight back. So the pot always grows by 2x the matched amount.
    let matched = game.bets[0].min(game.bets[1]);
    for i in 0..2 {
        game.stacks[i] += game.bets[i] - matched;
    }
    game.pot += 2 * matched;
    game.bets = [0; 2];
    game.acted = [false; 2];

    // Board cards come off the deck right after the four hole cards.
    if game.phase == Phase::River || game.stacks.contains(&0) {
        // Nobody can bet any more: run out the board and show down.
        game.board.copy_from_slice(&deck.cards[4..9]);
        showdown(game, hands);
        return;
    }
    let (next, shown) = match game.phase {
        Phase::Preflop => (Phase::Flop, 3),
        Phase::Flop => (Phase::Turn, 4),
        _ => (Phase::River, 5),
    };
    game.phase = next;
    game.board[..shown].copy_from_slice(&deck.cards[4..4 + shown]);
    // After the flop the player out of position (not the button) acts first.
    game.to_act = 1 - game.dealer;
    game.min_raise = big_blind(game.hand_number);
}

fn showdown(game: &mut Game, hands: [&Hand; 2]) {
    let score = |hand: &Hand| {
        let mut seven = [0u8; 7];
        seven[..2].copy_from_slice(&hand.cards);
        seven[2..].copy_from_slice(&game.board);
        poker::best_of_seven(seven)
    };
    let (creator, opponent) = (score(hands[0]), score(hands[1]));
    match creator.cmp(&opponent) {
        std::cmp::Ordering::Greater => game.stacks[0] += game.pot,
        std::cmp::Ordering::Less => game.stacks[1] += game.pot,
        // The pot is always even (see end_street), so no odd chip to place.
        std::cmp::Ordering::Equal => {
            game.stacks[0] += game.pot / 2;
            game.stacks[1] += game.pot / 2;
        }
    }
    // Shown hands are public, folded ones never are.
    game.shown = Some([hands[0].cards, hands[1].cards]);
    end_hand(game);
}

/// Clears the table and decides whether the match is over.
fn end_hand(game: &mut Game) {
    game.pot = 0;
    game.bets = [0; 2];
    game.acted = [false; 2];
    let [c, o] = game.stacks;
    game.winner = if o == 0 {
        Some(0)
    } else if c == 0 {
        Some(1)
    } else if game.hand_number >= MAX_HANDS && c != o {
        // Level stacks after hand 6 play sudden death: no winner yet.
        Some(if c > o { 0 } else { 1 })
    } else {
        None
    };
    game.phase = if game.winner.is_some() { Phase::Finished } else { Phase::Waiting };
}

fn big_blind(hand_number: u8) -> u16 {
    BLINDS[(hand_number.min(MAX_HANDS) - 1) as usize].1
}
