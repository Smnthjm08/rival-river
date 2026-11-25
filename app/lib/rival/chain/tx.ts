import { Connection, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import { PROGRAM_ERRORS } from "./program";
import type { WalletSigner } from "./signer";

/** A failed transaction. `code` is the program's error name when there is one. */
export class TxError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** The program error name in an error or its logs, e.g. "NotYourTurn". */
export function programErrorName(e: unknown): string | undefined {
  if (e instanceof TxError && e.code) return e.code;
  const text = String((e as { message?: string })?.message ?? e) + JSON.stringify((e as { logs?: unknown })?.logs ?? "");
  const named = text.match(/Error Code: (\w+)/);
  if (named) return named[1];
  const hex = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (hex) return PROGRAM_ERRORS.get(parseInt(hex[1], 16));
  const custom = text.match(/"Custom":(\d+)/);
  if (custom) return PROGRAM_ERRORS.get(Number(custom[1]));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One transaction to send: where, what, and which keypairs co-sign it. */
export interface TxPlan {
  conn: Connection;
  ixs: TransactionInstruction[];
  signers?: Keypair[];
}

async function build(plan: TxPlan, feePayer: Keypair | WalletSigner) {
  const tx = new Transaction().add(...plan.ixs);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = (await plan.conn.getLatestBlockhash("confirmed")).blockhash;
  if (feePayer instanceof Keypair) tx.partialSign(feePayer);
  if (plan.signers?.length) tx.partialSign(...plan.signers);
  return tx;
}

/**
 * Sends and polls until confirmed (no websockets: works the same on Solana
 * and the TEE). On Solana a refused instruction fails preflight and costs
 * nothing; on the rollup preflight doesn't simulate, so the failed
 * transaction still executes and is recorded (gasless, but not free of noise).
 */
async function submit(conn: Connection, tx: Transaction): Promise<string> {
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  } catch (e) {
    throw new TxError(String((e as Error)?.message ?? e), programErrorName(e));
  }
  for (let i = 0; i < 90; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) {
      const t = await conn
        .getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
        .catch(() => null);
      const detail = { err: st.err, logs: t?.meta?.logMessages };
      throw new TxError(`tx ${sig} failed: ${JSON.stringify(st.err)}`, programErrorName(detail));
    }
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
    await sleep(1000);
  }
  throw new TxError(`tx ${sig} not confirmed after 90s`);
}

/** One transaction, paid and signed by a keypair (session key) or wallet. */
export async function sendTx(plan: TxPlan, feePayer: Keypair | WalletSigner): Promise<string> {
  let tx = await build(plan, feePayer);
  // Browser wallets return a signed copy rather than signing in place.
  if (!(feePayer instanceof Keypair)) tx = await feePayer.signTransaction(tx);
  return submit(plan.conn, tx);
}

/**
 * Several transactions, in order, with one wallet prompt for all of them
 * (signAllTransactions). Each waits for the previous one to confirm.
 */
export async function sendTxs(plans: TxPlan[], wallet: WalletSigner): Promise<string[]> {
  const unsigned = await Promise.all(plans.map((p) => build(p, wallet)));
  const txs = await wallet.signAllTransactions(unsigned);
  const sigs: string[] = [];
  for (const [i, tx] of txs.entries()) sigs.push(await submit(plans[i].conn, tx));
  return sigs;
}
