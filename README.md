# Rival River

Heads-up Texas Hold’em between two friends, with real stakes and private cards.
Both players put the same amount of USDC into escrow on Solana, and the match
winner takes both stakes. Built for the Entertainment Finance edition of
MagicBlock’s Solana Blitz V10.

**Play it on devnet: [rival-river.smnthjm08.dev](https://rival-river.smnthjm08.dev)**

You need two Solana wallets set to devnet (Phantom, Backpack or Solflare), each
with a little devnet SOL and devnet USDC from
[faucet.circle.com](https://faucet.circle.com).

## How a match works

1. **Create a table.** Choose the stake (1, 5, 10 or 25 USDC) and who can
   join: anyone with the invite link, or one specific wallet. Your USDC goes
   into the table’s escrow. **One wallet approval.**
2. **Your friend joins** from the invite link and matches the stake. The same
   transaction creates the game and moves it to MagicBlock’s private rollup.
   **One wallet approval.** The first hand starts once both players have the
   table on screen, so keep that tab open.
3. **Play** up to six hands. Each player starts with 100 virtual chips, and the
   blinds rise every hand. **No wallet approvals:** each browser tab signs with
   its own session key.
4. **Collect.** The game returns to Solana and the program pays both stakes to
   the winner. Either player can send the payout. **One wallet approval.**

### Session keys

When you stake, your browser tab makes a session key (kept in the tab’s
`sessionStorage`) and names it in the same transaction. On the rollup that key
can sign in to read the table and your own hole cards, make the table private,
check you in, play your moves, and bring the finished game back to Solana. It
can’t move any money: the stakes stay in an escrow on Solana that only the
program can pay out.

If the tab is closed, a new tab asks for one signature to sign in and one
approval to register a new key, then plays without approvals again.

## Match rules

- **Check-in:** no hand starts until both players are at the table. If one
  never arrives, both stakes can be refunded after the match deadline.
- **Joining:** the join names the stake you agreed to. If the table has changed
  since, it fails and nothing is paid.
- **Blinds:** 5/10, 10/20, 20/40, 30/60, 40/80, 50/100 (one level per hand).
- **Winning:** a player wins as soon as the other has no chips. After six
  hands, the chip leader wins. If stacks are level, sudden-death hands at
  50/100 decide the match.
- **All-ins:** with two players there are no side pots. Any chips the opponent
  cannot match go back to the player who bet them.
- **Split pots:** chips are divided evenly. Both players always put the same
  amount into the pot, so there is never an odd chip.
- **Turn timer:** each player has 30 seconds to act. After that the other
  player can claim the timeout: the slow player checks if they can, otherwise
  folds. A player who never sends their shuffle secret forfeits the hand.
- **Refunds:** the creator can cancel and take their stake back until a friend
  joins. A match has two hours from its start; after that no more hands are
  played. Ten minutes later, if it still isn’t settled, anyone can return both
  stakes. A finished match that is back on Solana can only be paid to its
  winner.

## How it uses MagicBlock

| Feature | What it does here |
| --- | --- |
| Ephemeral Rollups | The game, deck and both hands are delegated, so every move is a rollup transaction. They are committed and undelegated when the match ends. |
| Private Ephemeral Rollup (TEE) | Permissions decide who can read each account. |
| VRF | Supplies the randomness for each shuffle. |

The USDC escrow is never delegated: it stays on Solana for the whole match.

| Account | Lives on | Who can read it on the rollup |
| --- | --- | --- |
| `Table` and USDC vault | Solana | (public, not delegated) |
| `Game`: chips, pot, board, turn | rollup | both players |
| `Hand`: one per player | rollup | only that player (wallet or session key) |
| `Deck` | rollup | nobody |

### Fair shuffle

Each shuffle hashes MagicBlock VRF randomness together with a secret from each
player. The oracle doesn’t know the secrets, and a player doesn’t know the
other’s secret, so none of them can work out the deck alone. Both secrets must
be in before the randomness is requested.

### Keeping cards private

- Before anything goes back to Solana, the deck, hole cards and unused secrets
  are wiped.
- The rollup’s transaction history also holds the secrets. On devnet, closing
  the game accounts after payout made that history readable by anyone, so the
  program never closes them (about 0.0053 SOL of rent per match stays in them).
- `scripts/smoke-devnet.ts` checks on the devnet TEE that neither the opponent
  nor the public can read a secret transaction, during a hand or after payout.

### Program instructions

| Runs on | Instructions |
| --- | --- |
| Solana | `create_table`, `join_table`, `cancel_table`, `init_game`, `delegate_game`, `settle`, `refund`, `close_refunded` |
| Private rollup | `init_permissions`, `check_in`, `set_session_key`, `start_hand`, `submit_secret`, `request_shuffle`, `callback_shuffle` (VRF), `act`, `claim_timeout`, `undelegate_game` |

| Devnet address | |
| --- | --- |
| Program | [`7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi`](https://explorer.solana.com/address/7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi?cluster=devnet) |
| TEE validator | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` |
| USDC mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

## Repository

| Path | Contents |
| --- | --- |
| [`programs/rival_river`](programs/rival_river) | The Anchor program, with LiteSVM tests |
| [`app`](app) | Next.js client; the chain library is in `app/lib/rival` |
| [`tests-magicsvm`](tests-magicsvm) | Rollup tests that run Solana and the rollup in one process |
| [`scripts`](scripts) | Devnet deploy and end-to-end smoke test |

## Running it

Needs Bun, the Solana CLI and Anchor 1.0.2. The Rust versions are pinned by the
`rust-toolchain.toml` files.

```sh
cd app && bun install && bun dev      # http://localhost:3000
```

`/preview` shows the table with sample data, no wallet needed.

### Tests

```sh
anchor build -- --features localnet   # pins MagicSVM's validator, never deploy this build
cargo test -p rival_river             # Solana-side instructions (LiteSVM)
cd tests-magicsvm && cargo test       # delegation, permissions, VRF, play, settle
```

### Devnet end to end

These send real devnet transactions from `~/.config/solana/id.json`, which needs
about 0.2 SOL and 0.02 USDC.

```sh
bun install                           # in the repository root
anchor build                          # the devnet build
bun scripts/smoke-devnet.ts           # one match, with the privacy checks
cd app && bun scripts/lib-smoke.ts    # a match through the app's own library
```

Set `BASE_RPC` (first script) or `NEXT_PUBLIC_BASE_RPC` (second script and the
app) to use another Solana RPC. The app’s value is visible in the browser.

`./scripts/deploy-devnet.sh` upgrades the program (upgrade authority only).

## Known limitations

- Devnet only, and the program has not been audited.
- Keeping past cards private depends on the rollup holding on to the permissions
  and on the game accounts staying open. This was checked for minutes after
  payout, not long term.
- Not tested: whether another program running on the rollup can read private
  accounts during a hand.
- If a player never checks in, both stakes stay locked until the refund opens,
  about two hours and ten minutes.
- If a finished game never makes it back from the rollup, the refund opens like
  any other and returns both stakes.
- Whether a player has sent this hand’s shuffle secret is only visible to that
  player, so the other side can’t tell “waiting for their secret” from “waiting
  for the oracle”. The 30-second timeout covers both.
- Every rollup transaction is recorded even when the program refuses it (the
  rollup doesn’t simulate first), so a refused move still appears in its history.

## Scope

One complete heads-up match, from wallet connection through payout. Tables of
three to six players, side pots, spectators and mainnet are out of scope.

[MagicBlock docs](https://docs.magicblock.gg/) · [Blitz](https://build.magicblock.app/?stage=blitz)
