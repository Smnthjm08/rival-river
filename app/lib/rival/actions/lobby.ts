//! Before the match, on Solana: open, join or cancel a table. Joining also
//! creates the game and hands it to the private rollup.
import { BN } from "@anchor-lang/core";
import { ComputeBudgetProgram, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { PROGRAM_ID, ROUTER_RPC, TEE_RPC, USDC_MINT } from "../config";
import { base, waitFor } from "../chain/connection";
import {
  matchKeys,
  rollupAccounts,
  usdcAccount as usdcOf,
  type MatchKeys,
} from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { sendTx, TxError } from "../chain/tx";
import { sessionKeypair } from "../session/session-key";
import { saveInvite } from "../session/invite";
import type { TableView } from "../game/state";

const m = program.methods;

/**
 * Opens a table and stakes. `stake` is in USDC base units (1 USDC = 1_000_000).
 * Names this tab's session key for the match, so the creator plays it with
 * no further wallet prompt (unless this tab is closed before the match).
 */
export async function createTable(
  wallet: WalletSigner,
  /** The only wallet that may join, or null for an open table: whoever has the invite link. */
  opponent: PublicKey | null,
  stake: number
): Promise<{ keys: MatchKeys; invite: Keypair | null }> {
  const keys = matchKeys(wallet.publicKey, opponent ?? PublicKey.default, new BN(Date.now()));
  const session = sessionKeypair(keys.game, wallet.publicKey);
  // Open tables: a throwaway keypair whose seed goes in the link (see invite.ts).
  const invite = opponent ? null : Keypair.generate();
  const ix = await m
    .createTable(
      keys.tableId,
      opponent ?? PublicKey.default,
      new BN(stake),
      session.publicKey,
      invite?.publicKey ?? PublicKey.default
    )
    .accountsPartial({
      creator: wallet.publicKey,
      table: keys.table,
      creatorToken: usdcOf(wallet.publicKey),
      vault: keys.vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  await sendTx({ conn: base, ixs: [ix] }, wallet);
  if (invite) saveInvite(keys.table, invite);
  return { keys, invite };
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
export async function joinTable(
  wallet: WalletSigner,
  /** As the player saw it: the join fails if the stake has changed since. */
  table: Pick<TableView, "keys" | "stake">,
  /** Open tables: the invite link's keypair, which co-signs. */
  invite: Keypair | null = null
) {
  // On an open table the joiner becomes the opponent, so the game's Hand
  // addresses (seeded by the opponent) are derived from this wallet.
  const t = table.keys;
  const keys = matchKeys(t.creator, wallet.publicKey, t.tableId);
  const session = sessionKeypair(keys.game, wallet.publicKey);
  const join = await m
    .joinTable(session.publicKey, new BN(table.stake))
    .accountsPartial({
      opponent: wallet.publicKey,
      invite: invite?.publicKey ?? null,
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
  return sendTx({ conn: base, ixs, signers: invite ? [invite] : [] }, wallet);
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
  const { result } = (await r.json()) as { result?: { isDelegated?: boolean; fqdn?: string } };
  if (!result?.isDelegated) return false;
  // Everything on the rollup goes to TEE_RPC: reads, session-key sign-ins,
  // moves. The program pins the TEE validator, so the router should always
  // point there; if it doesn't, stop rather than talk to the wrong rollup.
  const host = (u: string) => new URL(u).host;
  if (result.fqdn && host(result.fqdn) !== host(TEE_RPC)) {
    throw new TxError(`The game is on ${host(result.fqdn)}, not the private rollup at ${host(TEE_RPC)}`, "WrongRollup");
  }
  return true;
}

export const waitForRollup = (keys: MatchKeys) =>
  waitFor("the game to reach the rollup", () => isOnRollup(keys), 90);
