import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { BASE_RPC, PROGRAM_ID, ROUTER_RPC, USDC_MINT } from "./config";
import { program } from "./program";
import { handOf, matchKeys, permissionAccounts, rollupAccounts, seatOf, vrfIdentity, type MatchKeys } from "./pdas";
import { sessionKeypair } from "./session";
import type { WalletSigner } from "./signer";
import { fetchGame } from "./state";
import { teeConnection } from "./tee";
import { sendTx, sendTxs, TxError } from "./tx";

export const base = new Connection(BASE_RPC, "confirmed");
const m = program.methods;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, seconds: number): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(1000);
  }
  throw new TxError(`timed out waiting for ${what}`);
}

const usdcOf = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner);

// ---- Lobby (Solana) ----------------------------------------------------------

/** Opens a table and stakes. `stake` is in USDC base units (1 USDC = 1_000_000). */
export async function createTable(wallet: WalletSigner, opponent: PublicKey, stake: number): Promise<MatchKeys> {
  const keys = matchKeys(wallet.publicKey, opponent, new BN(Date.now()));
  const ix = await m
    .createTable(keys.tableId, opponent, new BN(stake))
    .accountsPartial({ creator: wallet.publicKey, table: keys.table, creatorToken: usdcOf(wallet.publicKey), vault: keys.vault, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  await sendTx({ conn: base, ixs: [ix] }, wallet);
  return keys;
}

/** The invited opponent matches the stake. */
export async function joinTable(wallet: WalletSigner, keys: MatchKeys) {
  const ix = await m
    .joinTable()
    .accountsPartial({ opponent: wallet.publicKey, table: keys.table, mint: USDC_MINT, opponentToken: usdcOf(wallet.publicKey), vault: keys.vault, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  return sendTx({ conn: base, ixs: [ix] }, wallet);
}

/** Before anyone joins, the creator takes their stake back. */
export async function cancelTable(wallet: WalletSigner, keys: MatchKeys) {
  const ix = await m
    .cancelTable()
    .accountsPartial({ creator: wallet.publicKey, table: keys.table, mint: USDC_MINT, creatorToken: usdcOf(wallet.publicKey), vault: keys.vault, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  return sendTx({ conn: base, ixs: [ix] }, wallet);
}

/**
 * Creator only, once the opponent has joined: creates the game and hands it
 * to the private rollup. One wallet prompt for both transactions.
 */
export async function startMatch(wallet: WalletSigner, keys: MatchKeys) {
  const plans = [];
  if (!(await base.getAccountInfo(keys.game))) {
    const init = await m.initGame().accountsPartial({ creator: wallet.publicKey, table: keys.table, ...rollupAccounts(keys) }).instruction();
    plans.push({ conn: base, ixs: [init] });
  }
  const delegated = Object.entries(rollupAccounts(keys)).flatMap(([name, account]) => {
    const cap = name[0].toUpperCase() + name.slice(1);
    return [
      [name, account],
      [`buffer${cap}`, delegateBufferPdaFromDelegatedAccountAndOwnerProgram(account, PROGRAM_ID)],
      [`delegationRecord${cap}`, delegationRecordPdaFromDelegatedAccount(account)],
      [`delegationMetadata${cap}`, delegationMetadataPdaFromDelegatedAccount(account)],
    ];
  });
  const delegate = await m
    .delegateGame()
    .accountsPartial({ payer: wallet.publicKey, table: keys.table, ...Object.fromEntries(delegated) })
    .instruction();
  // Delegating four accounts needs more than the default 200k compute units.
  plans.push({ conn: base, ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), delegate] });
  return sendTxs(plans, wallet);
}

/** True once the router reports the game delegated to the rollup. */
export async function isOnRollup(keys: MatchKeys): Promise<boolean> {
  const r = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getDelegationStatus", params: [keys.game.toBase58()] }),
  });
  const { result } = (await r.json()) as { result?: { isDelegated?: boolean } };
  return !!result?.isDelegated;
}

export const waitForRollup = (keys: MatchKeys) => waitFor("the game to reach the rollup", () => isOnRollup(keys), 90);

// ---- Rollup ------------------------------------------------------------------

export interface Seat {
  keys: MatchKeys;
  seat: 0 | 1;
  /** Reads as this wallet: Game and your own Hand. */
  tee: Connection;
  /** Signs every move of the match. */
  session: Keypair;
}

/**
 * Each player, once the game is on the rollup: TEE login (one signMessage),
 * then one transaction that makes the accounts private (init_permissions,
 * idempotent: both players send it) and registers this tab's session key.
 * Skips the transaction when both are already done, e.g. after a reload.
 */
export async function enterRollup(wallet: WalletSigner, keys: MatchKeys): Promise<Seat> {
  const seat = seatOf(keys, wallet.publicKey);
  if (seat === null) throw new TxError("This wallet doesn't play at this table", "NotAPlayer");
  const tee = await teeConnection(wallet);
  const session = sessionKeypair(keys.game, wallet.publicKey);
  // The TEE can lag the router by a few seconds.
  const game = await waitFor("the game on the rollup", () => fetchGame(tee, keys.game), 30);
  const ixs = [];
  if (!game.permissionsReady) {
    ixs.push(await m.initPermissions().accountsPartial({ payer: wallet.publicKey, ...rollupAccounts(keys), ...permissionAccounts(keys) }).instruction());
  }
  if (!game.sessionKeys[seat]?.equals(session.publicKey)) {
    ixs.push(await m.setSessionKey(session.publicKey).accountsPartial({ player: wallet.publicKey, game: keys.game }).instruction());
  }
  if (ixs.length) await sendTx({ conn: tee, ixs }, wallet);
  return { keys, seat, tee, session };
}

export type Action = { fold: object } | { check: object } | { call: object } | { raise: { to: number } };

/** The match's moves. All signed by the session key: no wallet prompts. */
export const moves = {
  startHand: async (s: Seat) =>
    sendTx({ conn: s.tee, ixs: [await m.startHand().accountsPartial({ player: s.session.publicKey, game: s.keys.game }).instruction()] }, s.session),

  /** A fresh secret from the browser's secure random generator. */
  submitSecret: async (s: Seat) => {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    const ix = await m.submitSecret(secret).accountsPartial({ player: s.session.publicKey, game: s.keys.game, hand: handOf(s.keys, s.seat) }).instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },

  requestShuffle: async (s: Seat) => {
    const ix = await m.requestShuffle().accountsPartial({ player: s.session.publicKey, ...rollupAccounts(s.keys), programIdentity: vrfIdentity }).instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },

  act: async (s: Seat, action: Action) => {
    const ix = await m.act(action as never).accountsPartial({ player: s.session.publicKey, ...rollupAccounts(s.keys) }).instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },

  claimTimeout: async (s: Seat) => {
    const ix = await m.claimTimeout().accountsPartial({ player: s.session.publicKey, ...rollupAccounts(s.keys) }).instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },
};

// ---- After the match (rollup, then Solana) -----------------------------------

/**
 * Either player (or anyone, for settle) once the match is Finished: brings
 * the game back to Solana and pays both stakes to the winner, creating their
 * USDC account if needed. Two wallet prompts; safe to retry.
 */
export async function finishMatch(wallet: WalletSigner, s: Pick<Seat, "keys" | "tee">) {
  const { keys } = s;
  const backOnSolana = async () => (await base.getAccountInfo(keys.game))?.owner.equals(PROGRAM_ID);
  if (!(await backOnSolana())) {
    const ix = await m.undelegateGame().accountsPartial({ payer: wallet.publicKey, ...rollupAccounts(keys), ...permissionAccounts(keys) }).instruction();
    await sendTx({ conn: s.tee, ixs: [ix] }, wallet);
    await waitFor("the game to return to Solana", backOnSolana, 180);
  }
  const game = await fetchGame(base, keys.game);
  if (game?.winner == null) throw new TxError("The match has no winner yet", "MatchNotFinished");
  const winner = game.players[game.winner];
  const winnerToken = usdcOf(winner);
  const settle = await m
    .settle()
    .accountsPartial({ table: keys.table, ...rollupAccounts(keys), mint: USDC_MINT, winnerToken, vault: keys.vault, creator: keys.creator, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  const ata = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, winnerToken, winner, USDC_MINT);
  return sendTx({ conn: base, ixs: [ata, settle] }, wallet);
}
