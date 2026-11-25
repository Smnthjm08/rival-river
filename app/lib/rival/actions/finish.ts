//! After the match: bring the game back to Solana and pay the winner.
import { createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, USDC_MINT } from "../config";
import { base, waitFor } from "../chain/connection";
import { permissionAccounts, rollupAccounts, usdcAccount as usdcOf } from "../chain/pdas";
import { program } from "../chain/program";
import type { WalletSigner } from "../chain/signer";
import { sendTx, TxError } from "../chain/tx";
import { fetchGame } from "../game/state";
import type { Seat } from "./rollup";

const m = program.methods;

/**
 * Either player (or anyone, for settle) once the match is Finished: brings
 * the game back to Solana and pays both stakes to the winner, creating their
 * USDC account if needed. Two wallet prompts; safe to retry.
 */
export async function finishMatch(wallet: WalletSigner, s: Pick<Seat, "keys" | "tee">) {
  const { keys } = s;
  const backOnSolana = async () => (await base.getAccountInfo(keys.game))?.owner.equals(PROGRAM_ID);
  if (!(await backOnSolana())) {
    const ix = await m.undelegateGame().accountsPartial({ payer: wallet.publicKey, ...rollupAccounts(keys), ...permissionAccounts(keys) }).instruction();
    await sendTx({ conn: s.tee, ixs: [ix] }, wallet);
    await waitFor("the game to return to Solana", backOnSolana, 180);
  }
  const game = await fetchGame(base, keys.game);
  if (game?.winner == null) throw new TxError("The match has no winner yet", "MatchNotFinished");
  const winner = game.players[game.winner];
  const winnerToken = usdcOf(winner);
  const settle = await m
    .settle()
    .accountsPartial({ table: keys.table, ...rollupAccounts(keys), mint: USDC_MINT, winnerToken, vault: keys.vault, creator: keys.creator, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  const ata = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, winnerToken, winner, USDC_MINT);
  return sendTx({ conn: base, ixs: [ata, settle] }, wallet);
}
