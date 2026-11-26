import { Connection, Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { TEE_RPC } from "../config";
import type { WalletSigner } from "./signer";
import { store } from "../session/storage";

/**
 * A connection to the private rollup that reads as this wallet (or session
 * key): Game, and the player's own Hand. Logging in is one signMessage; the
 * token is kept for the tab, so reloading doesn't ask again. Pass a session
 * keypair (see asSigner) to sign in with no wallet prompt at all.
 */
const tokenKey = (wallet: { toBase58(): string }) => `rr:tee-token:${wallet.toBase58()}`;

export async function teeConnection(wallet: Pick<WalletSigner, "publicKey" | "signMessage">): Promise<Connection> {
  const key = tokenKey(wallet.publicKey);
  let saved = JSON.parse(store.get(key) ?? "null") as { token: string; expiresAt: number } | null;
  // A minute of margin so a token doesn't expire mid-request.
  if (!saved || saved.expiresAt < Date.now() + 60_000) {
    saved = await getAuthToken(TEE_RPC, wallet.publicKey, (m) => wallet.signMessage(m));
    store.set(key, JSON.stringify(saved));
  }
  const url = new URL(TEE_RPC);
  url.searchParams.set("token", saved.token);
  return new Connection(url.toString(), "confirmed");
}

/** A session keypair as the signer teeConnection needs: signs locally. */
export const asSigner = (kp: Keypair) => ({
  publicKey: kp.publicKey,
  signMessage: async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey),
});

/** True if this tab still holds an unexpired TEE login for the wallet, so teeConnection won't prompt. */
export function hasTeeLogin(wallet: { toBase58(): string }): boolean {
  const saved = JSON.parse(store.get(tokenKey(wallet)) ?? "null") as { expiresAt: number } | null;
  return !!saved && saved.expiresAt > Date.now() + 60_000;
}

/** Forgets this tab's TEE login, so the next teeConnection signs in again. */
export function clearTeeLogin(wallet: { toBase58(): string }) {
  store.remove(tokenKey(wallet));
}

/**
 * True when the TEE refused the login token (HTTP 401 InvalidToken): it
 * expired or the TEE no longer accepts it. Every read fails until you sign
 * in again, Game included, since it isn't public either.
 */
export function isTeeAuthError(e: unknown): boolean {
  return /401|InvalidToken/.test(String((e as { message?: string })?.message ?? e));
}
