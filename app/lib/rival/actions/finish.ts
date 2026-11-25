//! After the match: bring the game back to Solana and pay the winner.
//! Both players' tabs may run this at the same time; whichever lands second
//! finds the work done and returns quietly.
import { createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, USDC_MINT } from "../config";
import { base, waitFor } from "../chain/connection";
import { permissionAccounts, rollupAccounts, usdcAccount as usdcOf, type MatchKeys } from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { programErrorName, sendTx, TxError } from "../chain/tx";
import { fetchGame } from "../game/state";
import type { Seat } from "./rollup";

const m = program.methods;

/**
 * True once the game is off the rollup: owned by the program on Solana again,
 * or already closed by settle / close_refunded (the other tab got there first).
 * Only meaningful for a game that was delegated.
 */
const backOnSolana = async (keys: MatchKeys) => {
  const info = await base.getAccountInfo(keys.game);
  return !info || info.owner.equals(PROGRAM_ID);
};
const tableClosed = async (keys: MatchKeys) => !(await base.getAccountInfo(keys.table));

/**
 * Brings the game back from the rollup (a player's wallet, once the match is
 * Finished or past its deadline). Returns once it's on Solana, or already
 * settled. If the other tab already sent it, waits for theirs instead of failing.
 */
export async function undelegate(wallet: WalletSigner, s: Pick<Seat, "keys" | "tee">): Promise<void> {
  const { keys } = s;
  if (await backOnSolana(keys)) return;
  const ix = await m.undelegateGame().accountsPartial({ payer: wallet.publicKey, ...rollupAccounts(keys), ...permissionAccounts(keys) }).instruction();
  try {
    await sendTx({ conn: s.tee, ixs: [ix] }, wallet);
  } catch (e) {
    // The program refused (e.g. MatchNotFinished): nothing to wait for.
    if (programErrorName(e)) throw e;
    // Otherwise the game is most likely already on its way back.
  }
  await waitFor("the game to return to Solana", () => backOnSolana(keys), 180);
}

/**
 * Either player (or anyone, for settle) once the match is Finished: brings
 * the game back to Solana and pays both stakes to the winner, creating their
 * USDC account if needed. Up to two wallet prompts; safe to retry and to run
 * from both tabs. Returns the settle signature, or null if it was already
 * settled (by the other tab, or an earlier try).
 */
export async function finishMatch(wallet: WalletSigner, s: Pick<Seat, "keys" | "tee">): Promise<string | null> {
  const { keys } = s;
  if (await tableClosed(keys)) return null;
  await undelegate(wallet, s);
  const game = await fetchGame(base, keys.game);
  if (!game) return null; // settle closed it between our checks
  if (game.winner == null) throw new TxError("The match has no winner yet", "MatchNotFinished");
  const winner = game.players[game.winner];
  const winnerToken = usdcOf(winner);
  const settle = await m
    .settle()
    .accountsPartial({ table: keys.table, ...rollupAccounts(keys), mint: USDC_MINT, winnerToken, vault: keys.vault, creator: keys.creator, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  const ata = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, winnerToken, winner, USDC_MINT);
  try {
    return await sendTx({ conn: base, ixs: [ata, settle] }, wallet);
  } catch (e) {
    if (await tableClosed(keys)) return null; // the other tab settled first
    throw e;
  }
}
