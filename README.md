# Rival River

Rival River is a heads-up Texas Hold’em match between two friends, designed
for the Entertainment Finance edition of MagicBlock’s Solana Blitz V10.
Both players stake the same amount of USDC. The match winner takes both
stakes.

## How a match works

1. Create a table, invite a friend, and choose the stake. Your USDC goes
   into the table’s escrow.
2. Your friend joins by putting in the same stake. Each player starts with
   100 virtual chips.
3. Play up to six hands of heads-up Hold’em with a standard deck. Blinds rise
   every hand so the match always finishes.
4. Settle the match on Solana. The winner receives both stakes.

## Match rules

- **Blinds:** 5/10, 10/20, 20/40, 30/60, 40/80, 50/100 (one level per hand).
- **Winning:** a player wins as soon as the other has no chips. After six
  hands, the chip leader wins. If stacks are level, sudden-death hands at
  50/100 decide the match.
- **All-ins:** with two players there are no side pots. Any chips the
  opponent cannot match go back to the player who bet them.
- **Split pots:** chips are divided evenly. Both players always put the
  same amount into the pot, so there is never an odd chip.
- **Turn timer:** each player has 30 seconds to act. After that the other
  player can claim the timeout: the slow player checks if they can,
  otherwise folds. A player who never sends their shuffle secret forfeits
  the hand.
- **Refunds:** the creator can cancel and take their stake back until a
  friend joins. A match has two hours from its start; after that no
  more hands are played. Ten minutes later, if it still isn’t settled,
  anyone can return both stakes. Those ten minutes let a match that ended
  just before the deadline pay its winner. A finished match can only be
  settled.

## Where MagicBlock fits

The Rust/Anchor poker program runs live hands on a MagicBlock Private
Ephemeral Rollup:

- The game account (bets, pot, community cards, whose turn it is) is
  readable by both players.
- Each player’s hole cards live in a separate account that only that
  player’s wallet can read.
- The undealt deck is readable by nobody.
- The shuffle mixes MagicBlock VRF randomness with a secret from each
  player, so neither the oracle nor either player can work out the deck.
- Before anything goes back to Solana, the deck, hole cards and secrets are
  wiped, so folded hands are never revealed.

Solana devnet handles the USDC escrow, refunds, and the payout to the
winner.

## MVP scope

The target demo is one complete heads-up match, from wallet connection
through prize settlement.

Out of scope for the MVP: tables of three to six players, side pots,
spectators, and mainnet.

[MagicBlock docs](https://docs.magicblock.gg/) · [Blitz submission](https://build.magicblock.app/?stage=blitz#submit)
