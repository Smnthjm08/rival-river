import { Connection } from "@solana/web3.js";
import { BASE_RPC } from "../config";
import { TxError } from "./tx";

/** Solana devnet: stakes, setup and payout. */
export const base = new Connection(BASE_RPC, "confirmed");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` once a second until it returns something truthy. */
export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  seconds: number
): Promise<T> {
  for (let i = 0; i < seconds; i++) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    await sleep(1000);
  }
  throw new TxError(`timed out waiting for ${what}`);
}
