//! When a match won't finish: return both stakes, then reclaim the rent.
//!
//!   refund         anyone, once refundOpensAt has passed. Pays each player
//!                  their stake back. Closes everything if the game is on
//!                  Solana; if it's still on the rollup, the Table stays.
//!   undelegate     a player (see finish.ts), past the match deadline, to
//!                  bring a refunded game back from the rollup.
//!   closeRefunded  anyone, after that: returns all the rent to the creator.
import {
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SETTLE_GRACE_SECONDS, USDC_MINT } from "../config";
import { base } from "../chain/connection";
import { rollupAccounts, usdcAccount, type MatchKeys } from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { sendTx } from "../chain/tx";
import type { TableView } from "../game/state";

const m = program.methods;

/** Unix seconds when refund is allowed, or null if this table can't be refunded. */
export function refundOpensAt(t: TableView): number | null {
  if (t.status === "locked") return t.deadline; // joined, never started
  if (t.status === "inPlay") return t.deadline + SETTLE_GRACE_SECONDS;
  return null; // open (cancel instead), settled or already refunded
}

/** Returns both stakes. Recreates either player's USDC account if it was closed. */
export async function refund(wallet: WalletSigner, keys: MatchKeys) {
  const [creatorToken, opponentToken] = [
    usdcAccount(keys.creator),
    usdcAccount(keys.opponent),
  ];
  const ix = await m
    .refund()
    .accountsPartial({
      table: keys.table,
      ...rollupAccounts(keys),
      mint: USDC_MINT,
      creatorToken,
      opponentToken,
      vault: keys.vault,
      creator: keys.creator,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const atas = [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      creatorToken,
      keys.creator,
      USDC_MINT
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      opponentToken,
      keys.opponent,
      USDC_MINT
    ),
  ];
  return sendTx({ conn: base, ixs: [...atas, ix] }, wallet);
}

/** After a refund left the game on the rollup and undelegate brought it back. */
export async function closeRefunded(wallet: WalletSigner, keys: MatchKeys) {
  const ix = await m
    .closeRefunded()
    .accountsPartial({
      table: keys.table,
      ...rollupAccounts(keys),
      creator: keys.creator,
    })
    .instruction();
  return sendTx({ conn: base, ixs: [ix] }, wallet);
}
