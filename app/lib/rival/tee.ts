import { Connection } from "@solana/web3.js";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { TEE_RPC } from "./config";
import type { WalletSigner } from "./signer";
import { store } from "./storage";

/**
 * A connection to the private rollup that reads as this wallet: Game, and
 * the wallet's own Hand. Logging in is one signMessage; the token is kept
 * for the tab, so reloading doesn't ask again.
 */
export async function teeConnection(wallet: Pick<WalletSigner, "publicKey" | "signMessage">): Promise<Connection> {
  const key = `rr:tee-token:${wallet.publicKey.toBase58()}`;
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
