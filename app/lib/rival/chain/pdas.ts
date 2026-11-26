import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import { PROGRAM_ID, USDC_MINT } from "../config";

const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

/** Every address of one match. Seat 0 is the creator, seat 1 the opponent. */
export interface MatchKeys {
  tableId: BN;
  creator: PublicKey;
  opponent: PublicKey;
  table: PublicKey;
  vault: PublicKey;
  game: PublicKey;
  deck: PublicKey;
  handCreator: PublicKey;
  handOpponent: PublicKey;
}

export function matchKeys(
  creator: PublicKey,
  opponent: PublicKey,
  tableId: BN
): MatchKeys {
  const table = pda(
    Buffer.from("table"),
    creator.toBuffer(),
    tableId.toArrayLike(Buffer, "le", 8)
  );
  const game = pda(Buffer.from("game"), table.toBuffer());
  return {
    tableId,
    creator,
    opponent,
    table,
    vault: getAssociatedTokenAddressSync(USDC_MINT, table, true),
    game,
    deck: pda(Buffer.from("deck"), game.toBuffer()),
    handCreator: pda(Buffer.from("hand"), game.toBuffer(), creator.toBuffer()),
    handOpponent: pda(
      Buffer.from("hand"),
      game.toBuffer(),
      opponent.toBuffer()
    ),
  };
}

/** The four accounts that move to the rollup, as instruction accounts. */
export const rollupAccounts = (k: MatchKeys) => ({
  game: k.game,
  deck: k.deck,
  handCreator: k.handCreator,
  handOpponent: k.handOpponent,
});

export const permissionAccounts = (k: MatchKeys) => ({
  gamePermission: permissionPdaFromAccount(k.game),
  deckPermission: permissionPdaFromAccount(k.deck),
  handCreatorPermission: permissionPdaFromAccount(k.handCreator),
  handOpponentPermission: permissionPdaFromAccount(k.handOpponent),
});

export const seatOf = (k: MatchKeys, wallet: PublicKey): 0 | 1 | null =>
  wallet.equals(k.creator) ? 0 : wallet.equals(k.opponent) ? 1 : null;

export const handOf = (k: MatchKeys, seat: 0 | 1) =>
  seat === 0 ? k.handCreator : k.handOpponent;

/** Signs the program's VRF requests (`#[vrf]`'s program_identity). */
export const vrfIdentity = PublicKey.findProgramAddressSync(
  [Buffer.from("identity")],
  PROGRAM_ID
)[0];

/** A wallet's USDC account (its associated token account). */
export const usdcAccount = (owner: PublicKey) =>
  getAssociatedTokenAddressSync(USDC_MINT, owner);
