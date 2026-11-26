// Plays one match on devnet through lib/rival, the way two browser tabs
// would: both players' clients run their loops at the same time, so they
// race to send the automatic steps. Counts each wallet's signing prompts:
// expected 1 each (create; join) plus the payout for whoever settles.
//
//   cd app && bun scripts/lib-smoke.ts
//
// Needs ~0.2 devnet SOL and 2 * STAKE devnet USDC in the CLI wallet; the
// opponent is ../target/smoke/opponent.json (funded by this script).
import { Keypair, SystemProgram, type Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import {
  base,
  canSitSilently,
  createTable,
  enterRollup,
  fetchHand,
  fetchMatch,
  fetchTable,
  finishMatch,
  HandTracker,
  joinTable,
  keypairWallet,
  moves,
  programErrorName,
  runSteps,
  sendTx,
  USDC_MINT,
  waitForRollup,
  type Action,
  type Seat,
  type WalletSigner,
} from "../lib/rival";

const STAKE = 10_000; // 0.01 USDC each
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const load = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

/** A keypair wallet that counts how often it's asked to sign: the popups a real wallet would show. */
function counted(kp: Keypair) {
  const w = keypairWallet(kp);
  const prompts: string[] = [];
  const wallet: WalletSigner = {
    publicKey: w.publicKey,
    signTransaction: <T extends Transaction>(tx: T) => (
      prompts.push("signTransaction"), w.signTransaction(tx)
    ),
    signAllTransactions: <T extends Transaction>(txs: T[]) => (
      prompts.push(`signAllTransactions(${txs.length})`),
      w.signAllTransactions(txs)
    ),
    signMessage: (m) => (prompts.push("signMessage"), w.signMessage(m)),
  };
  return { wallet, prompts };
}

const opponentPath = "../target/smoke/opponent.json";
if (!existsSync(opponentPath))
  throw new Error(
    `run ../scripts/smoke-devnet.ts once first, or create ${opponentPath}`
  );
const C = counted(load(`${homedir()}/.config/solana/id.json`));
const O = counted(load(opponentPath));
const usdc = (k: Keypair | WalletSigner) =>
  getAssociatedTokenAddressSync(USDC_MINT, k.publicKey);

/** Passive for two hands (check/call down every street), then shove. */
function choose(
  g: NonNullable<Awaited<ReturnType<typeof fetchMatch>>["game"]>,
  me: number
): Action {
  const other = 1 - me;
  const toCall = g.bets[other] - g.bets[me];
  if (
    g.handNumber > 2 &&
    g.stacks[other] > 0 &&
    g.bets[me] + g.stacks[me] > g.bets[other]
  ) {
    return { raise: { to: g.bets[me] + g.stacks[me] } };
  }
  return toCall > 0 ? { call: {} } : { check: {} };
}

async function play(s: Seat, name: string) {
  const started = Date.now();
  let lastHand = 0;
  // A real table pauses ~4s after each hand; 1s keeps this run short.
  const tracker = new HandTracker(s.seat, 1);
  let reported = 0;
  while (Date.now() - started < 8 * 60_000) {
    const { game, hand } = await fetchMatch(s.tee, s.keys, s.seat);
    if (!game) throw new Error(`${name}: can't read the game`);
    const due = tracker.due(game, hand);
    const r = tracker.lastResult;
    if (s.seat === 0 && r && r.handNumber !== reported) {
      reported = r.handNumber;
      const show = r.shown
        ? `showdown ${r.shown
            .map((h) => h.map((c) => c.rank + c.suit).join(" "))
            .join(" vs ")}`
        : "fold";
      console.log(
        `  result hand ${r.handNumber}: ${show}, board ${
          r.board.map((c) => c.rank + c.suit).join(" ") || "-"
        }, won ${r.won}`
      );
    }
    if (game.phase === "finished") return game;
    if (hand?.cards && game.handNumber !== lastHand) {
      lastHand = game.handNumber;
      console.log(
        `  ${name} hand ${game.handNumber}: holds ${hand.cards
          .map((c) => c.rank + c.suit)
          .join(" ")}`
      );
    }
    await runSteps(s, due);
    if (
      ["preflop", "flop", "turn", "river"].includes(game.phase) &&
      game.toAct === s.seat
    ) {
      const action = choose(game, s.seat);
      // A stale snapshot: the other tab's move already changed whose turn it is.
      await moves.act(s, action).catch((e) => {
        if (!["NotYourTurn", "NotBetting"].includes(programErrorName(e) ?? ""))
          throw e;
      });
    }
    await sleep(400);
  }
  throw new Error(`${name}: match didn't finish in 8 minutes`);
}

async function main() {
  console.log("[0] fund the opponent");
  const fund = [];
  if ((await base.getBalance(O.wallet.publicKey)) < 50_000_000) {
    fund.push(
      SystemProgram.transfer({
        fromPubkey: C.wallet.publicKey,
        toPubkey: O.wallet.publicKey,
        lamports: 100_000_000,
      })
    );
  }
  fund.push(
    createAssociatedTokenAccountIdempotentInstruction(
      C.wallet.publicKey,
      usdc(O.wallet),
      O.wallet.publicKey,
      USDC_MINT
    ),
    createTransferCheckedInstruction(
      usdc(C.wallet),
      USDC_MINT,
      usdc(O.wallet),
      C.wallet.publicKey,
      STAKE,
      6
    )
  );
  await sendTx(
    { conn: base, ixs: fund },
    load(`${homedir()}/.config/solana/id.json`)
  );
  C.prompts.length = 0;

  console.log("[1] lobby: create, then join (which also starts the match)");
  const keys = await createTable(C.wallet, O.wallet.publicKey, STAKE);
  console.log(`  table ${keys.table.toBase58()}`);
  console.log(
    `  join + init_game + delegate: ${await joinTable(O.wallet, keys)}`
  );
  await waitForRollup(keys);

  console.log(
    "[2] both players sit down at once, with their stake-time session keys"
  );
  const table = (await fetchTable(base, keys.table))!;
  console.log(
    `  silent for creator: ${canSitSilently(
      table,
      C.wallet.publicKey
    )}, opponent: ${canSitSilently(table, O.wallet.publicKey)}`
  );
  const [sc, so] = await Promise.all([
    enterRollup(C.wallet, table),
    enterRollup(O.wallet, table),
  ]);
  const peek = await fetchHand(sc.tee, keys.handOpponent).catch(() => null);
  console.log(
    `  creator reading the opponent's Hand: ${
      peek === null ? "refused (good)" : "READABLE (bad)"
    }`
  );

  console.log("[3] play (both loops racing)");
  const t0 = Date.now();
  const [final] = await Promise.all([
    play(sc, "creator"),
    play(so, "opponent"),
  ]);
  console.log(
    `  finished after ${final.handNumber} hands in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(0)}s, stacks ${final.stacks}`
  );

  console.log(
    "[4] finish: both tabs at once; one settles, the other finds it done"
  );
  const winner = final.winner!;
  const winnerUsdc = usdc(winner === 0 ? C.wallet : O.wallet);
  const before = Number((await getAccount(base, winnerUsdc)).amount);
  // As the UI does: each tab's session key undelegates, the wallet only settles.
  const sigs = await Promise.all([
    finishMatch(C.wallet, sc),
    finishMatch(O.wallet, so),
  ]);
  console.log(
    `  settle signatures: creator ${
      sigs[0] ?? "null (already settled)"
    }, opponent ${sigs[1] ?? "null (already settled)"}`
  );
  const gained = Number((await getAccount(base, winnerUsdc)).amount) - before;
  console.log(
    `  ${winner === 0 ? "creator" : "opponent"} won: +${gained / 1e6} USDC ${
      gained === 2 * STAKE ? "(both stakes, good)" : "(WRONG)"
    }`
  );

  console.log("[5] wallet prompts");
  console.log(`  creator  (${C.prompts.length}): ${C.prompts.join(", ")}`);
  console.log(`  opponent (${O.prompts.length}): ${O.prompts.join(", ")}`);
  if (peek !== null || gained !== 2 * STAKE) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nSTOPPED:", e?.message ?? e, programErrorName(e) ?? "");
  process.exitCode = 1;
});
