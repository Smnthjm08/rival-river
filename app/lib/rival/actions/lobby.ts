//! Before the match, on Solana: open, join or cancel a table, then hand the
//! game to the private rollup.
import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { PROGRAM_ID, ROUTER_RPC, USDC_MINT } from "../config";
import { base, waitFor } from "../chain/connection";
import { matchKeys, rollupAccounts, usdcAccount as usdcOf, type MatchKeys } from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { sendTx, sendTxs } from "../chain/tx";

const m = program.methods;

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
