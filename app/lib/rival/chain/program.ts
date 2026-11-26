import { AnchorProvider, Program } from "@anchor-lang/core";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import idl from "../idl/rival_river.json";
import type { RivalRiver } from "../idl/rival_river";
import { BASE_RPC } from "../config";

// Only used to build instructions and decode accounts, so the provider's
// wallet never signs anything.
const noWallet = {
  publicKey: PublicKey.default,
  signTransaction: async <T extends Transaction>(tx: T) => tx,
  signAllTransactions: async <T extends Transaction>(txs: T[]) => txs,
};

export const program = new Program<RivalRiver>(
  idl as RivalRiver,
  new AnchorProvider(
    new Connection(BASE_RPC, "confirmed"),
    noWallet as never,
    {}
  )
);

/** Error names from the IDL, by code (6000, 6001, ...). */
export const PROGRAM_ERRORS = new Map(idl.errors.map((e) => [e.code, e.name]));
