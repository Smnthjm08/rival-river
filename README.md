# Rival River

Rival River is a heads-up Texas Hold’em match between two friends, designed
for the Entertainment Finance edition of MagicBlock’s Solana Blitz V10.
Both players stake the same amount of USDC. The match winner takes both
stakes.

## How a match works

1. Create a table: choose the stake and your friend’s wallet. Your USDC goes
   into the table’s escrow, and you get an invite link. **One wallet
   approval.**
2. Your friend opens the link and matches the stake. The same transaction
   creates the game and moves it to MagicBlock’s private rollup, so the
   match starts right away. **One wallet approval.** Each player starts with
   100 virtual chips.
3. Play up to six hands of heads-up Hold’em with a standard deck. Blinds rise
   every hand so the match always finishes. **No wallet approvals:** each
   browser tab plays with its own session key.
4. The winner collects: the game comes back to Solana and both stakes are
   paid out. **One wallet approval.**

### Session keys

When you stake, your browser tab makes a session key (kept in the tab’s
`sessionStorage`) and names it in the same transaction. On the rollup that
key can sign in to read the table and your own hole cards, make the table
private, play your moves, and bring the finished game back to Solana. It
can’t move any money: the stakes stay in an escrow on Solana that only the
program can pay out, and only to the winner.

If the tab is closed, a new tab asks for one signature to sign in and one
approval to register a new key, then plays without approvals again.

## Match rules

- **Check-in:** the first hand starts once both players’ tabs are at the
  table, so nobody loses hands before they arrive. If one never does, the
  stakes are refunded after the match deadline.
- **Joining:** the join names the stake you agreed to. If the table has
  changed since, it fails and nothing is paid.
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
  player (their wallet or their session key) can read.
- The undealt deck is readable by nobody.
- The shuffle mixes MagicBlock VRF randomness with a secret from each
  player, so neither the oracle nor either player can work out the deck.
- Before anything goes back to Solana, the deck, hole cards and secrets are
  wiped, so folded hands are never revealed.
- The game accounts stay on Solana after the match (their rent, about
  0.0053 SOL a match, isn’t returned). On devnet, closing them made the
  match’s transaction history readable by anyone.

Solana devnet handles the USDC escrow, refunds, and the payout to the
winner.

## Running it

The program is deployed on devnet at
`7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi` and delegates to MagicBlock’s
devnet TEE validator. You need a devnet wallet (Phantom, Backpack, Solflare)
with a little devnet SOL and USDC from [faucet.circle.com](https://faucet.circle.com).

```sh
cd app && bun install && bun dev      # http://localhost:3000
```

`/preview` shows the live table with sample data, no wallet needed.

Tests:

```sh
anchor build -- --features localnet   # pins MagicSVM's validator, never deploy this build
cargo test -p rival_river             # Solana-side instructions (LiteSVM)
cd tests-magicsvm && cargo test       # rollup flow: delegation, permissions, VRF, play, settle
```

## Known limitations

- Whether a player has sent this hand’s shuffle secret is only visible to
  that player, so the other side can’t tell “waiting for their secret” from
  “waiting for the oracle”. The 30-second timeout covers both.
- Every rollup transaction is recorded even when the program refuses it
  (the rollup doesn’t simulate first), so a refused move still shows up in
  the explorer.

## MVP scope

The target demo is one complete heads-up match, from wallet connection
through prize settlement.

Out of scope for the MVP: tables of three to six players, side pots,
spectators, and mainnet.

[MagicBlock docs](https://docs.magicblock.gg/) · [Blitz submission](https://build.magicblock.app/?stage=blitz#submit)
