//! Before the match, on Solana: open, join or cancel a table. Joining also
//! creates the game and hands it to the private rollup.
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
import {
  matchKeys,
  rollupAccounts,
  usdcAccount as usdcOf,
  type MatchKeys,
} from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { sendTx } from "../chain/tx";
import { sessionKeypair } from "../session/session-key";

const m = program.methods;

/**
 * Opens a table and stakes. `stake` is in USDC base units (1 USDC = 1_000_000).
 * Names this tab's session key for the match, so the creator plays it with
 * no further wallet prompt (unless this tab is closed before the match).
 */
export async function createTable(
  wallet: WalletSigner,
  opponent: PublicKey,
  stake: number
): Promise<MatchKeys> {
  const keys = matchKeys(wallet.publicKey, opponent, new BN(Date.now()));
  const session = sessionKeypair(keys.game, wallet.publicKey);
  const ix = await m
    .createTable(keys.tableId, opponent, new BN(stake), session.publicKey)
    .accountsPartial({
      creator: wallet.publicKey,
      table: keys.table,
      creatorToken: usdcOf(wallet.publicKey),
      vault: keys.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  await sendTx({ conn: base, ixs: [ix] }, wallet);
  return keys;
}

const initGameIx = (payer: PublicKey, keys: MatchKeys) =>
  m
    .initGame()
    .accountsPartial({ payer, table: keys.table, ...rollupAccounts(keys) })
    .instruction();

const delegateIx = (payer: PublicKey, keys: MatchKeys) => {
  const delegated = Object.entries(rollupAccounts(keys)).flatMap(
    ([name, account]) => {
      const cap = name[0].toUpperCase() + name.slice(1);
      return [
        [name, account],
        [
          `buffer${cap}`,
          delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
            account,
            PROGRAM_ID
          ),
        ],
        [
          `delegationRecord${cap}`,
          delegationRecordPdaFromDelegatedAccount(account),
        ],
        [
          `delegationMetadata${cap}`,
          delegationMetadataPdaFromDelegatedAccount(account),
        ],
      ];
    }
  );
  return m
    .delegateGame()
    .accountsPartial({
      payer,
      table: keys.table,
      ...Object.fromEntries(delegated),
    })
    .instruction();
};

// Creating the game and delegating its four accounts needs well over the
// default 200k compute units.
const computeLimit = () =>
  ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });

/**
 * The invited opponent matches the stake and starts the match: join, create
 * the game, and hand it to the private rollup, in one transaction and one
 * wallet prompt. Also names this tab's session key.
 */
export async function joinTable(wallet: WalletSigner, keys: MatchKeys) {
  const session = sessionKeypair(keys.game, wallet.publicKey);
  const join = await m
    .joinTable(session.publicKey)
    .accountsPartial({
      opponent: wallet.publicKey,
      table: keys.table,
      mint: USDC_MINT,
      opponentToken: usdcOf(wallet.publicKey),
      vault: keys.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const ixs = [
    computeLimit(),
    join,
    await initGameIx(wallet.publicKey, keys),
    await delegateIx(wallet.publicKey, keys),
  ];
  return sendTx({ conn: base, ixs }, wallet);
}

/** Before anyone joins, the creator takes their stake back. */
export async function cancelTable(wallet: WalletSigner, keys: MatchKeys) {
  const ix = await m
    .cancelTable()
    .accountsPartial({
      creator: wallet.publicKey,
      table: keys.table,
      mint: USDC_MINT,
      creatorToken: usdcOf(wallet.publicKey),
      vault: keys.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return sendTx({ conn: base, ixs: [ix] }, wallet);
}

/**
 * Either player, if the match didn't reach the rollup when the opponent
 * joined (e.g. an older client joined): creates the game if it's missing,
 * then hands it to the private rollup. One transaction, one prompt.
 */
export async function startMatch(wallet: WalletSigner, keys: MatchKeys) {
  const ixs = [computeLimit()];
  if (!(await base.getAccountInfo(keys.game)))
    ixs.push(await initGameIx(wallet.publicKey, keys));
  ixs.push(await delegateIx(wallet.publicKey, keys));
  return sendTx({ conn: base, ixs }, wallet);
}

/** True once the router reports the game delegated to the rollup. */
export async function isOnRollup(keys: MatchKeys): Promise<boolean> {
  const r = await fetch(ROUTER_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [keys.game.toBase58()],
    }),
  });
  const { result } = (await r.json()) as { result?: { isDelegated?: boolean } };
  return !!result?.isDelegated;
}

export const waitForRollup = (keys: MatchKeys) =>
  waitFor("the game to reach the rollup", () => isOnRollup(keys), 90);
