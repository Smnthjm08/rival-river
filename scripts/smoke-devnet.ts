// End-to-end smoke test of the deployed program on devnet + the devnet TEE.
// Plays one full match between your CLI wallet (creator) and a throwaway
// opponent, and checks what each player can and can't see on the private
// rollup. Writes every key and signature to target/smoke/last-run.json.
//
//   bun scripts/smoke-devnet.ts
//
// Needs: ~0.2 devnet SOL and 2 * STAKE devnet USDC (4zMMC9…) in the CLI wallet.
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  DELEGATION_PROGRAM_ID,
  getAuthToken,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import idl from "../target/idl/rival_river.json";
import type { RivalRiver } from "../target/types/rival_river";

const BASE_RPC = process.env.BASE_RPC ?? "https://rpc.magicblock.app/devnet";
const ROUTER = "https://devnet-router.magicblock.app/";
const STAKE = 10_000; // 0.01 USDC each
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TEE_VALIDATOR = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";

const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  keys: {},
  signatures: [],
  checks: {},
};
const log = (...a: any[]) => console.log(...a);
const sig = (step: string, layer: "solana" | "rollup", s: string) => {
  report.signatures.push({ step, layer, signature: s });
  log(`  ${step}: ${s}`);
};
const check = (name: string, pass: boolean, detail: string) => {
  report.checks[name] = { pass, detail };
  log(`  ${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- keys -------------------------------------------------------------------
const loadKeypair = (path: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(path, "utf8")))
  );
const creator = loadKeypair(`${homedir()}/.config/solana/id.json`);
mkdirSync("target/smoke", { recursive: true });
const opponentPath = "target/smoke/opponent.json";
if (!existsSync(opponentPath))
  writeFileSync(
    opponentPath,
    JSON.stringify(Array.from(Keypair.generate().secretKey))
  );
const opponent = loadKeypair(opponentPath);

const base = new Connection(BASE_RPC, "confirmed");
const program = new Program<RivalRiver>(
  idl as any,
  new AnchorProvider(base, new Wallet(creator), {})
);
const PID = program.programId;
const pda = (...seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PID)[0];

const tableId = new BN(Date.now());
const table = pda(
  Buffer.from("table"),
  creator.publicKey.toBuffer(),
  tableId.toArrayLike(Buffer, "le", 8)
);
const game = pda(Buffer.from("game"), table.toBuffer());
const deck = pda(Buffer.from("deck"), game.toBuffer());
const handCreator = pda(
  Buffer.from("hand"),
  game.toBuffer(),
  creator.publicKey.toBuffer()
);
const handOpponent = pda(
  Buffer.from("hand"),
  game.toBuffer(),
  opponent.publicKey.toBuffer()
);
const vault = getAssociatedTokenAddressSync(USDC, table, true);
const creatorUsdc = getAssociatedTokenAddressSync(USDC, creator.publicKey);
const opponentUsdc = getAssociatedTokenAddressSync(USDC, opponent.publicKey);
const matchAccounts = { game, deck, handCreator, handOpponent };
const permissions = {
  gamePermission: permissionPdaFromAccount(game),
  deckPermission: permissionPdaFromAccount(deck),
  handCreatorPermission: permissionPdaFromAccount(handCreator),
  handOpponentPermission: permissionPdaFromAccount(handOpponent),
};
Object.assign(report.keys, {
  programId: PID.toBase58(),
  creator: creator.publicKey.toBase58(),
  opponent: opponent.publicKey.toBase58(),
  tableId: tableId.toString(),
  table: table.toBase58(),
  vault: vault.toBase58(),
  game: game.toBase58(),
  deck: deck.toBase58(),
  handCreator: handCreator.toBase58(),
  handOpponent: handOpponent.toBase58(),
  ...Object.fromEntries(
    Object.entries(permissions).map(([k, v]) => [k, v.toBase58()])
  ),
  ...Object.fromEntries(
    Object.entries(matchAccounts).map(([k, v]) => [
      `delegationRecord_${k}`,
      delegationRecordPdaFromDelegatedAccount(v).toBase58(),
    ])
  ),
  vrfProgramIdentity: pda(Buffer.from("identity")).toBase58(),
  usdcMint: USDC.toBase58(),
  creatorUsdc: creatorUsdc.toBase58(),
  opponentUsdc: opponentUsdc.toBase58(),
});

// ---- sending: poll for confirmation (no websockets, works on base and TEE) --
async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[]
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  const s = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  for (let i = 0; i < 90; i++) {
    const st = (await conn.getSignatureStatuses([s])).value[0];
    if (st?.err) {
      const t = await conn
        .getTransaction(s, {
          maxSupportedTransactionVersion: 1,
          commitment: "confirmed",
        })
        .catch(() => null);
      throw new Error(
        `tx ${s} failed: ${JSON.stringify(st.err)}\n${
          t?.meta?.logMessages?.join("\n") ?? ""
        }`
      );
    }
    if (
      st?.confirmationStatus === "confirmed" ||
      st?.confirmationStatus === "finalized"
    )
      return s;
    await sleep(1000);
  }
  throw new Error(`tx ${s} not confirmed after 90s`);
}

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  seconds = 90
): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(1000);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function routerStatus(account: PublicKey) {
  const r = await fetch(ROUTER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toBase58()],
    }),
  });
  const body = (await r.json()) as {
    result: {
      isDelegated: boolean;
      fqdn?: string;
      delegationRecord?: { authority: string };
    };
  };
  return body.result;
}

// Program camelCases the IDL: account names are "game", "deck", ... too.
const decode = (name: "game" | "deck" | "hand" | "table", data: Buffer) =>
  program.coder.accounts.decode(name, data);
const readGame = async (conn: Connection) =>
  decode("game", (await conn.getAccountInfo(game))!.data);

// ---- instructions -----------------------------------------------------------
const delegateIxs = async (payer: PublicKey) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
  await program.methods
    .delegateGame()
    .accountsPartial({
      payer,
      table,
      ...Object.fromEntries(
        Object.entries(matchAccounts).flatMap(([k, v]) => {
          const cap = k.charAt(0).toUpperCase() + k.slice(1);
          return [
            [k, v],
            [
              `buffer${cap}`,
              delegateBufferPdaFromDelegatedAccountAndOwnerProgram(v, PID),
            ],
            [
              `delegationRecord${cap}`,
              delegationRecordPdaFromDelegatedAccount(v),
            ],
            [
              `delegationMetadata${cap}`,
              delegationMetadataPdaFromDelegatedAccount(v),
            ],
          ];
        })
      ),
    } as any)
    .instruction(),
];
const initPermissionsIx = (payer: PublicKey) =>
  program.methods
    .initPermissions()
    .accountsPartial({ payer, ...matchAccounts, ...permissions })
    .instruction();
const undelegateIx = (payer: PublicKey) =>
  program.methods
    .undelegateGame()
    .accountsPartial({ payer, ...matchAccounts })
    .instruction();
const actIx = (player: PublicKey, action: any) =>
  program.methods
    .act(action)
    .accountsPartial({ player, ...matchAccounts })
    .instruction();

// ---- TEE login ---------------------------------------------------------------
async function teeConnection(
  endpoint: string,
  kp: Keypair
): Promise<Connection> {
  const root = endpoint.replace(/\/$/, "");
  const { token } = await getAuthToken(root, kp.publicKey, async (m) =>
    nacl.sign.detached(m, kp.secretKey)
  );
  const url = new URL(root);
  url.searchParams.set("token", token);
  return new Connection(url.toString(), "confirmed");
}

async function waitDelegated(): Promise<string> {
  const status = await waitFor(
    "router to report the game delegated",
    async () => {
      const s = await routerStatus(game);
      return s?.isDelegated && s.fqdn ? s : null;
    }
  );
  return status.fqdn!;
}

// ---- the run -----------------------------------------------------------------
async function main() {
  log(
    `program ${PID.toBase58()}\ncreator ${creator.publicKey.toBase58()}\nopponent ${opponent.publicKey.toBase58()}`
  );

  log("\n[0] funding");
  const usdcHeld = await getAccount(base, creatorUsdc)
    .then((a) => Number(a.amount))
    .catch(() => 0);
  if (usdcHeld < 2 * STAKE) {
    throw new Error(
      `creator holds ${usdcHeld / 1e6} devnet USDC, needs ${
        (2 * STAKE) / 1e6
      }. ` +
        `Get some at https://faucet.circle.com (Solana Devnet) for ${creator.publicKey.toBase58()}.`
    );
  }
  const fund: TransactionInstruction[] = [];
  if ((await base.getBalance(opponent.publicKey)) < 50_000_000) {
    fund.push(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: opponent.publicKey,
        lamports: 100_000_000,
      })
    );
  }
  fund.push(
    createAssociatedTokenAccountIdempotentInstruction(
      creator.publicKey,
      opponentUsdc,
      opponent.publicKey,
      USDC
    ),
    createTransferCheckedInstruction(
      creatorUsdc,
      USDC,
      opponentUsdc,
      creator.publicKey,
      STAKE,
      6
    )
  );
  sig(
    "fund opponent (SOL + USDC)",
    "solana",
    await send(base, fund, [creator])
  );

  log("\n[1] table, stakes, game (Solana)");
  sig(
    "create_table",
    "solana",
    await send(
      base,
      [
        await program.methods
          .createTable(
            tableId,
            opponent.publicKey,
            new BN(STAKE),
            PublicKey.default,
            PublicKey.default // named opponent, no invite link
          ) // no stake-time session key: tests the wallet path
          .accountsPartial({
            creator: creator.publicKey,
            table,
            creatorToken: creatorUsdc,
            vault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ],
      [creator]
    )
  );
  sig(
    "join_table",
    "solana",
    await send(
      base,
      [
        await program.methods
          .joinTable(PublicKey.default, new BN(STAKE))
          .accountsPartial({
            invite: null,
            opponent: opponent.publicKey,
            table,
            mint: USDC,
            opponentToken: opponentUsdc,
            vault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ],
      [opponent]
    )
  );
  sig(
    "init_game",
    "solana",
    await send(
      base,
      [
        await program.methods
          .initGame()
          .accountsPartial({
            payer: creator.publicKey,
            table,
            ...matchAccounts,
          })
          .instruction(),
      ],
      [creator]
    )
  );

  log("\n[2] delegate to the TEE");
  sig(
    "delegate_game",
    "solana",
    await send(base, await delegateIxs(creator.publicKey), [creator])
  );
  const fqdn = await waitDelegated();
  const record = await routerStatus(game);
  report.keys.rollupEndpoint = fqdn;
  check(
    "delegated to the pinned TEE validator",
    record.delegationRecord?.authority === TEE_VALIDATOR,
    `router fqdn ${fqdn}, delegation authority ${record.delegationRecord?.authority}`
  );
  const baseOwner = (await base.getAccountInfo(game))!.owner;
  check(
    "Solana copy locked by the delegation program",
    baseOwner.equals(DELEGATION_PROGRAM_ID),
    baseOwner.toBase58()
  );

  const teeC = await teeConnection(fqdn, creator);
  const teeO = await teeConnection(fqdn, opponent);
  const teePublic = new Connection(fqdn, "confirmed");
  await waitFor("game on the rollup", async () =>
    (await teeC.getAccountInfo(game))?.owner.equals(PID)
  );
  check(
    "rollup copy owned by the program",
    true,
    "getAccountInfo(game) on the TEE"
  );

  log("\n[3] permissions + (d) no undelegating mid-match");
  // Session keys: fresh and unfunded, as a browser tab would make them. Each
  // wallet signs once to register its key (the creator's rides along with
  // init_permissions); from here the keys sign every move of the match.
  const sessions = [Keypair.generate(), Keypair.generate()];
  report.keys.sessions = sessions.map((k) => k.publicKey.toBase58());
  const setSessionIx = (wallet: PublicKey, session: Keypair) =>
    program.methods
      .setSessionKey(session.publicKey)
      .accountsPartial({ player: wallet, game })
      .instruction();
  sig(
    "init_permissions + set_session_key (creator)",
    "rollup",
    await send(
      teeC,
      [
        await initPermissionsIx(creator.publicKey),
        await setSessionIx(creator.publicKey, sessions[0]),
      ],
      [creator]
    )
  );
  sig(
    "set_session_key (opponent)",
    "rollup",
    await send(
      teeO,
      [await setSessionIx(opponent.publicKey, sessions[1])],
      [opponent]
    )
  );
  // A trailing player could otherwise undelegate between hands until the
  // refund deadline splits the stakes 50/50.
  const early = await send(
    teeC,
    [await undelegateIx(opponent.publicKey)],
    [opponent]
  ).then(
    (s) => `went through: ${s}`,
    (e) => String(e)
  );
  check(
    "(d) undelegate refused before the match is finished",
    /MatchNotFinished|0x1784/.test(early),
    early.slice(0, 160)
  );

  log("\n[4] (b) who can read what");
  const can = async (conn: Connection, acc: PublicKey) =>
    (await conn.getAccountInfo(acc).catch(() => null)) !== null;
  const reads = {
    creatorReadsGame: await can(teeC, game),
    opponentReadsGame: await can(teeO, game),
    publicReadsGame: await can(teePublic, game),
    creatorReadsOwnHand: await can(teeC, handCreator),
    creatorReadsOpponentHand: await can(teeC, handOpponent),
    opponentReadsCreatorHand: await can(teeO, handCreator),
    creatorReadsDeck: await can(teeC, deck),
    opponentReadsDeck: await can(teeO, deck),
  };
  report.reads = reads;
  check(
    "(b) players read Game with flags 0",
    reads.creatorReadsGame && reads.opponentReadsGame,
    JSON.stringify({ c: reads.creatorReadsGame, o: reads.opponentReadsGame })
  );
  check(
    "Game hidden from logged-out readers",
    !reads.publicReadsGame,
    `public read: ${reads.publicReadsGame}`
  );
  check(
    "each Hand readable only by its owner",
    reads.creatorReadsOwnHand &&
      !reads.creatorReadsOpponentHand &&
      !reads.opponentReadsCreatorHand,
    JSON.stringify(reads)
  );
  check(
    "Deck readable by nobody",
    !reads.creatorReadsDeck && !reads.opponentReadsDeck,
    `c ${reads.creatorReadsDeck}, o ${reads.opponentReadsDeck}`
  );

  log("\n[5] hands (rollup, real VRF)");
  // Every move below is signed (and fee-paid) by an unfunded session key.
  const players = sessions;
  const teeOf = [teeC, teeO];
  for (const [i, p] of players.entries()) {
    sig(
      `check_in (${i ? "opponent" : "creator"})`,
      "rollup",
      await send(
        teeOf[i],
        [
          await program.methods
            .checkIn()
            .accountsPartial({ player: p.publicKey, game })
            .instruction(),
        ],
        [p]
      )
    );
  }
  // The TEE answers an unauthorized reader with a redacted stub (signature
  // only, no accounts, instructions or logs) — even the sender — so "seen"
  // means the message itself came back.
  const seen = async (conn: Connection, s: string) => {
    const t = await conn
      .getTransaction(s, {
        maxSupportedTransactionVersion: 1,
        commitment: "confirmed",
      })
      .catch(() => null);
    return (t?.transaction.message.staticAccountKeys.length ?? 0) > 0;
  };
  /** The first hand's submit_secret transactions, [creator's, opponent's]. */
  const secretSigs: string[] = [];
  for (let hand = 1; hand <= 10; hand++) {
    sig(
      `hand ${hand}: start_hand`,
      "rollup",
      await send(
        teeC,
        [
          await program.methods
            .startHand()
            .accountsPartial({ player: sessions[0].publicKey, game })
            .instruction(),
        ],
        [sessions[0]]
      )
    );
    for (const [i, p] of players.entries()) {
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)));
      const s = await send(
        teeOf[i],
        [
          await program.methods
            .submitSecret(secret)
            .accountsPartial({
              player: p.publicKey,
              game,
              hand: [handCreator, handOpponent][i],
            })
            .instruction(),
        ],
        [p]
      );
      sig(
        `hand ${hand}: submit_secret (${i ? "opponent" : "creator"})`,
        "rollup",
        s
      );
      if (hand === 1) secretSigs.push(s);
    }
    if (hand === 1) {
      const [own, other, pub] = [
        await seen(teeC, secretSigs[0]),
        await seen(teeO, secretSigs[0]),
        await seen(teePublic, secretSigs[0]),
      ];
      report.secretTxVisibility = {
        creatorSeesOwn: own,
        opponentSeesIt: other,
        publicSeesIt: pub,
      };
      check(
        "(b) opponent can't fetch the creator's submit_secret tx",
        !other && !pub,
        `creator ${own}, opponent ${other}, public ${pub}`
      );
    }

    const shuffle = await program.methods
      .requestShuffle()
      .accountsPartial({
        player: sessions[0].publicKey,
        ...matchAccounts,
        programIdentity: pda(Buffer.from("identity")),
      })
      .instruction();
    sig(
      `hand ${hand}: request_shuffle`,
      "rollup",
      await send(teeC, [shuffle], [sessions[0]])
    );
    if (hand === 1)
      check(
        "(c) TEE accepts a tx listing the opponent's Hand and the Deck",
        true,
        "request_shuffle confirmed"
      );
    const t0 = Date.now();
    await waitFor(
      "the VRF answer (phase Preflop)",
      async () => "preflop" in (await readGame(teeC)).phase,
      120
    );
    if (hand === 1)
      check(
        "real VRF shuffle on the TEE",
        true,
        `dealt ${((Date.now() - t0) / 1000).toFixed(1)}s after request_shuffle`
      );

    // Everyone shoves or calls until the hand is over.
    for (let step = 0; step < 8; step++) {
      const g = await readGame(teeC);
      const phase = Object.keys(g.phase)[0];
      if (!["preflop", "flop", "turn", "river"].includes(phase)) break;
      const me = g.toAct as number;
      const other = 1 - me;
      const shoveTo = g.bets[me] + g.stacks[me];
      const action =
        g.stacks[other] > 0 && shoveTo > g.bets[other]
          ? { raise: { to: shoveTo } }
          : g.bets[other] > g.bets[me]
          ? { call: {} }
          : { check: {} };
      const ix = await actIx(players[me].publicKey, action);
      if (hand === 1 && step === 1) {
        // (a) Can the player to act simulate their call and read back hidden accounts?
        const tx = new Transaction().add(ix);
        tx.feePayer = players[me].publicKey;
        tx.recentBlockhash = (await teeOf[me].getLatestBlockhash()).blockhash;
        const theirHand = me === 0 ? handOpponent : handCreator;
        const sim = await teeOf[me]
          .simulateTransaction(tx, [players[me]], [game, theirHand, deck])
          .catch((e) => ({ value: { err: String(e), accounts: null } } as any));
        const accs = sim.value.accounts as
          | (null | { data: [string, string] })[]
          | null;
        const got = (i: number) => !!accs?.[i]?.data?.[0];
        report.simulation = {
          err: sim.value.err,
          game: got(0),
          opponentHand: got(1),
          deck: got(2),
        };
        check(
          "(a) simulation doesn't reveal the opponent's Hand or the Deck",
          !got(1) && !got(2),
          JSON.stringify(report.simulation)
        );
        report.simulationRevealsGame = got(0);
      }
      sig(
        `hand ${hand}: act ${Object.keys(action)[0]}`,
        "rollup",
        await send(teeOf[me], [ix], [players[me]])
      );
    }
    const g = await readGame(teeC);
    log(
      `  after hand ${hand}: phase ${Object.keys(g.phase)[0]}, stacks ${
        g.stacks
      }`
    );
    if ("finished" in g.phase) break;
  }

  log("\n[6] undelegate and settle (Solana)");
  sig(
    "undelegate_game (Finished)",
    "rollup",
    await send(teeC, [await undelegateIx(creator.publicKey)], [creator])
  );
  await waitFor(
    "game back on Solana",
    async () => (await base.getAccountInfo(game))?.owner.equals(PID),
    180
  );
  // The history must stay private once the match has left the rollup: with
  // both secrets and the VRF answer anyone can rebuild the decks.
  const leaks: string[] = [];
  for (const [owner, s] of secretSigs.entries()) {
    const others = [
      ["the other player", teeOf[1 - owner]],
      ["the public", teePublic],
    ] as const;
    for (const [who, conn] of others)
      if (await seen(conn, s))
        leaks.push(`${who} reads seat ${owner}'s secret`);
  }
  check(
    "(e) after the match, nobody else can fetch a submit_secret tx",
    secretSigs.length === 2 && leaks.length === 0,
    leaks.join("; ") || "both stayed private"
  );

  const final = await readGame(base);
  const winner = final.winner as number;
  const winnerUsdc = [creatorUsdc, opponentUsdc][winner];
  const before = Number((await getAccount(base, winnerUsdc)).amount);
  sig(
    "settle",
    "solana",
    await send(
      base,
      [
        await program.methods
          .settle()
          .accountsPartial({
            table,
            ...matchAccounts,
            mint: USDC,
            winnerToken: winnerUsdc,
            vault,
            creator: creator.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      ],
      [creator]
    )
  );
  const after = Number((await getAccount(base, winnerUsdc)).amount);
  check(
    "winner paid both stakes",
    after - before === 2 * STAKE,
    `${winner ? "opponent" : "creator"} +${(after - before) / 1e6} USDC`
  );
  const closed = await Promise.all(
    [table, vault, game, deck, handCreator, handOpponent].map((a) =>
      base.getAccountInfo(a)
    )
  );
  check(
    "table, vault and match accounts closed",
    closed.every((a) => a === null),
    `${closed.filter((a) => a === null).length}/6 closed`
  );
}

main()
  .catch((e) => {
    report.error = String(e?.stack ?? e);
    console.error("\nSTOPPED:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    writeFileSync(
      "target/smoke/last-run.json",
      JSON.stringify(report, null, 2)
    );
    console.log("\nreport: target/smoke/last-run.json");
  });
