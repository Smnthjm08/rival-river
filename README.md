# Rival River

Rival River is a heads-up Texas Hold’em match between two friends, designed
for the Entertainment Finance edition of MagicBlock’s Solana Blitz V10.
Each player brings one collectible from their wallet. Both players see what
they could win before agreeing to play, and the match winner takes both
collectibles.

## How a match works

1. Create a table, invite a friend, and each choose one devnet collectible.
2. Review the stakes. Once both players accept, lock the collectibles in
   escrow and start the match with 100 virtual chips each.
3. Play up to six hands of heads-up Hold’em with a standard deck. Blinds rise
   every hand so the match always finishes.
4. Settle the match on Solana. The winner receives both collectibles.

## Match rules

- **Blinds:** 5/10, 10/20, 20/40, 30/60, 40/80, 50/100 (one level per hand).
- **Winning:** a player wins as soon as the other has no chips. After six
  hands, the chip leader wins. If stacks are level, a sudden-death hand
  decides the match.
- **All-ins:** with two players there are no side pots. Any chips the
  opponent cannot match go back to the player who bet them.
- **Split pots:** chips are divided evenly. An odd chip goes to the player
  out of position.
- **Turn timer:** a player who does not act in time checks if they can,
  otherwise folds. This keeps a stalled match from locking the escrow.
- **Refunds:** if the match never starts, or does not settle before a
  deadline, both collectibles return to their owners.

## Where MagicBlock fits

The Rust/Anchor poker program runs live hands on a MagicBlock Private
Ephemeral Rollup:

- The table account (bets, pot, community cards, whose turn it is) is
  readable by both players.
- Each player’s hole cards live in a separate account that only that
  player’s wallet can read.
- The undealt deck stays private. Hand accounts are closed inside the
  rollup before anything is committed to Solana, so folded hands are never
  revealed.
- Turn timeouts run through MagicBlock automation.

Solana devnet handles collectible ownership, escrow, refunds, and the
one-time transfer to the winner.

## MVP scope

The target demo is one complete heads-up match, from wallet connection
through prize settlement.

Open question to settle first: whether MagicBlock VRF can seed the shuffle
inside the private rollup without making the seed public. If the seed is
public, anyone could derive the deck, so the shuffle must mix in a secret
held inside the rollup.

Out of scope for the MVP: tables of three to six players, side pots,
spectators, and mainnet.

[MagicBlock docs](https://docs.magicblock.gg/) · [Blitz submission](https://build.magicblock.app/?stage=blitz#submit)
