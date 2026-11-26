# Rival River web app

The Next.js client for [Rival River](../README.md). Game rules, how the program
uses MagicBlock, and known limitations are in the main README.

```sh
bun install
bun dev        # http://localhost:3000
```

| Route | What it shows |
| --- | --- |
| `/` | Create a table |
| `/table/[creator]/[tableId]` | Join, play and collect |
| `/preview` | The table with sample data, no wallet needed |

## Layout

| Path | Contents |
| --- | --- |
| `app/` | Routes |
| `components/rr/` | Game interface |
| `components/ui/` | shadcn components |
| `hooks/` | Table and match polling, wallet |
| `lib/rival/` | Everything that talks to the chain |

`lib/rival` is split by job: `actions/` (lobby, rollup moves, automatic steps,
payout, refunds), `chain/` (connections, addresses, transactions, rollup
sign-in), `session/` (session keys and invite links) and `game/` (cards and
state). It has no React in it, so `scripts/lib-smoke.ts` plays a real devnet
match with the same code.

## Configuration

`NEXT_PUBLIC_BASE_RPC` overrides the Solana devnet RPC. It is visible in the
browser, so don’t put a private API key in it.

## After changing the program

```sh
anchor build        # in the repository root
bun run sync-idl    # in app/
```

Deploy the program before shipping an app built against its new interface.

## Checks

```sh
bun run lint
bun run build
```
