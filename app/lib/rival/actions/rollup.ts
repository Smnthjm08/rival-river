//! During the match, on the private rollup: join it once, then play. Every
//! move is signed by this tab's session key, so the wallet isn't asked.
import { Connection, Keypair } from "@solana/web3.js";
import { waitFor } from "../chain/connection";
import { handOf, permissionAccounts, rollupAccounts, seatOf, vrfIdentity, type MatchKeys } from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { teeConnection } from "../chain/tee";
import { sendTx, TxError } from "../chain/tx";
import { fetchGame } from "../game/state";
import { sessionKeypair } from "../session/session-key";

const m = program.methods;

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
