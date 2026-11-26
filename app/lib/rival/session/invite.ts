import { Keypair, type PublicKey } from "@solana/web3.js";
import { utils } from "@anchor-lang/core";

/**
 * Invite links for open tables. create_table stores the public half of a
 * throwaway keypair; its seed travels only in the link's #fragment, which
 * browsers never send to a server. join_table needs that keypair's
 * signature, so whoever has the link can join, and nobody can reuse a join
 * they saw on chain (it was signed for that transaction only).
 */

const bs58 = utils.bytes.bs58;

/** The #fragment part of an invite link. */
export const inviteFragment = (invite: Keypair) => `invite=${bs58.encode(invite.secretKey.slice(0, 32))}`;

/** The invite keypair from a URL hash, or null if there's none (or it's mangled). */
export function inviteFromHash(hash: string): Keypair | null {
  const m = hash.match(/invite=([1-9A-HJ-NP-Za-km-z]+)/);
  if (!m) return null;
  try {
    const seed = bs58.decode(m[1]);
    return seed.length === 32 ? Keypair.fromSeed(seed) : null;
  } catch {
    return null;
  }
}

// The creator keeps their own copy, so the waiting page can show the link
// again after a reload or in another tab. It only lets someone join (and
// stake), never touch the creator's money, so localStorage is fine.
const key = (table: PublicKey) => `rr:invite:${table.toBase58()}`;

export function saveInvite(table: PublicKey, invite: Keypair) {
  if (typeof localStorage !== "undefined") localStorage.setItem(key(table), inviteFragment(invite));
}

export function savedInvite(table: PublicKey): Keypair | null {
  return typeof localStorage === "undefined" ? null : inviteFromHash(localStorage.getItem(key(table)) ?? "");
}
