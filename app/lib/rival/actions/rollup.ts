//! During the match, on the private rollup: sit down once, then play. Every
//! move is signed by this tab's session key, so the wallet isn't asked.
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { waitFor } from "../chain/connection";
import {
  handOf,
  permissionAccounts,
  rollupAccounts,
  seatOf,
  vrfIdentity,
  type MatchKeys,
} from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { asSigner, teeConnection } from "../chain/tee";
import { sendTx, TxError } from "../chain/tx";
import { fetchGame, type TableView } from "../game/state";
import { savedSessionKey, sessionKeypair } from "../session/session-key";

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
 * True when this tab named its session key when staking: it can sit down
 * with no wallet prompt at all (see enterRollup).
 */
export function canSitSilently(table: TableView, wallet: PublicKey): boolean {
  const seat = seatOf(table.keys, wallet);
  const saved = savedSessionKey(table.keys.game, wallet);
  return (
    seat !== null &&
    !!saved &&
    !!table.sessionKeys[seat]?.equals(saved.publicKey)
  );
}

const initPermissionsIx = (payer: PublicKey, keys: MatchKeys) =>
  m
    .initPermissions()
    .accountsPartial({
      payer,
      ...rollupAccounts(keys),
      ...permissionAccounts(keys),
    })
    .instruction();

/**
 * Each player, once the game is on the rollup.
 *
 * Usually silent: the session key this tab named when staking signs in to
 * the TEE and, if the other tab hasn't yet, makes the accounts private
 * (init_permissions is idempotent).
 *
 * If this tab lost that key (closed, or another browser), the wallet signs
 * in (one signMessage) and registers a new key in one transaction. A key set
 * that way isn't a permission member, so the tab keeps reading as the wallet.
 */
export async function enterRollup(
  wallet: WalletSigner,
  table: TableView
): Promise<Seat> {
  const { keys } = table;
  const seat = seatOf(keys, wallet.publicKey);
  if (seat === null)
    throw new TxError("This wallet doesn't play at this table", "NotAPlayer");
  // The TEE can lag the router by a few seconds.
  const gameOn = (tee: Connection) =>
    waitFor("the game on the rollup", () => fetchGame(tee, keys.game), 30);

  // A stake-time session key can read the game itself (it's a permission
  // member), even after another tab replaced it: then only the wallet's
  // approval is needed to take the seat back, no sign-in message.
  let memberTee: Connection | null = null;
  if (canSitSilently(table, wallet.publicKey)) {
    const session = sessionKeypair(keys.game, wallet.publicKey);
    const tee = await teeConnection(asSigner(session));
    memberTee = tee;
    const game = await gameOn(tee);
    if (game.sessionKeys[seat]?.equals(session.publicKey)) {
      if (!game.permissionsReady)
        await sendTx(
          {
            conn: tee,
            ixs: [await initPermissionsIx(session.publicKey, keys)],
          },
          session
        );
      return { keys, seat, tee, session };
    }
    // The wallet replaced the key since (e.g. from another tab): fall through.
  }

  const tee = memberTee ?? (await teeConnection(wallet));
  const session = sessionKeypair(keys.game, wallet.publicKey);
  const game = await gameOn(tee);
  const ixs = [];
  if (!game.permissionsReady)
    ixs.push(await initPermissionsIx(wallet.publicKey, keys));
  if (!game.sessionKeys[seat]?.equals(session.publicKey)) {
    ixs.push(
      await m
        .setSessionKey(session.publicKey)
        .accountsPartial({ player: wallet.publicKey, game: keys.game })
        .instruction()
    );
  }
  if (ixs.length) await sendTx({ conn: tee, ixs }, wallet);
  return { keys, seat, tee, session };
}

export type Action =
  | { fold: object }
  | { check: object }
  | { call: object }
  | { raise: { to: number } };

/** The match's moves. All signed by the session key: no wallet prompts. */
export const moves = {
  /** "I'm at the table": hand 1 waits until both players have sent it. */
  checkIn: async (s: Seat) =>
    sendTx(
      {
        conn: s.tee,
        ixs: [
          await m
            .checkIn()
            .accountsPartial({ player: s.session.publicKey, game: s.keys.game })
            .instruction(),
        ],
      },
      s.session
    ),

  startHand: async (s: Seat) =>
    sendTx(
      {
        conn: s.tee,
        ixs: [
          await m
            .startHand()
            .accountsPartial({ player: s.session.publicKey, game: s.keys.game })
            .instruction(),
        ],
      },
      s.session
    ),

  /** A fresh secret from the browser's secure random generator. */
  submitSecret: async (s: Seat) => {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    const ix = await m
      .submitSecret(secret)
      .accountsPartial({
        player: s.session.publicKey,
        game: s.keys.game,
        hand: handOf(s.keys, s.seat),
      })
      .instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },

  requestShuffle: async (s: Seat) => {
    const ix = await m
      .requestShuffle()
      .accountsPartial({
        player: s.session.publicKey,
        ...rollupAccounts(s.keys),
        programIdentity: vrfIdentity,
      })
      .instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },

  act: async (s: Seat, action: Action) => {
    const ix = await m
      .act(action as never)
      .accountsPartial({
        player: s.session.publicKey,
        ...rollupAccounts(s.keys),
      })
      .instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },

  claimTimeout: async (s: Seat) => {
    const ix = await m
      .claimTimeout()
      .accountsPartial({
        player: s.session.publicKey,
        ...rollupAccounts(s.keys),
      })
      .instruction();
    return sendTx({ conn: s.tee, ixs: [ix] }, s.session);
  },
};
