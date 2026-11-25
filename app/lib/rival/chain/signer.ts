import { Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import type { PublicKey } from "@solana/web3.js";

/** What the library needs from a wallet. A wallet-adapter wallet fits as is. */
export interface WalletSigner {
  publicKey: PublicKey;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/** A keypair dressed as a wallet, for scripts and tests. */
export function keypairWallet(kp: Keypair): WalletSigner {
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async (txs) => {
      txs.forEach((tx) => tx.partialSign(kp));
      return txs;
    },
    signMessage: async (m) => nacl.sign.detached(m, kp.secretKey),
  };
}
