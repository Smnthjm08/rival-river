import { Keypair, PublicKey } from "@solana/web3.js";
import { store } from "./storage";

const keyFor = (game: PublicKey, wallet: PublicKey) => `rr:session:${game.toBase58()}:${wallet.toBase58()}`;

/**
 * This tab's session key for one game: it signs the match's moves so the
 * wallet doesn't have to. Made on first use and kept in sessionStorage. A
 * closed tab loses it; enterRollup then registers a new one.
 */
export function sessionKeypair(game: PublicKey, wallet: PublicKey): Keypair {
  const saved = savedSessionKey(game, wallet);
  if (saved) return saved;
  const kp = Keypair.generate();
  store.set(keyFor(game, wallet), JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** This tab's session key for the game, if it has one. Never makes one. */
export function savedSessionKey(game: PublicKey, wallet: PublicKey): Keypair | null {
  const saved = store.get(keyFor(game, wallet));
  return saved ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))) : null;
}
