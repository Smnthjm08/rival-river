"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Transaction } from "@solana/web3.js";
import { TxError, type WalletSigner } from "@/lib/rival";

/**
 * The connected wallet as the library's WalletSigner, or null when no
 * wallet is connected. Wallets without signAllTransactions fall back to one
 * prompt per transaction. Wallets that can't sign messages (some hardware
 * wallets) still play: only signing in from a tab that lost its session key
 * needs a message, and that path explains itself if it's missing.
 */
export function useWalletSigner(): WalletSigner | null {
  const { publicKey, signTransaction, signAllTransactions, signMessage } =
    useWallet();
  return useMemo(() => {
    if (!publicKey || !signTransaction) return null;
    return {
      publicKey,
      signTransaction: <T extends Transaction>(tx: T) => signTransaction(tx),
      signAllTransactions: signAllTransactions
        ? <T extends Transaction>(txs: T[]) => signAllTransactions(txs)
        : async <T extends Transaction>(txs: T[]) => {
            const signed: T[] = [];
            for (const tx of txs) signed.push(await signTransaction(tx));
            return signed;
          },
      signMessage:
        signMessage ??
        (async () => {
          throw new TxError(
            "This wallet can't sign messages, which signing in from a new tab needs",
            "NoSignMessage"
          );
        }),
    };
  }, [publicKey, signTransaction, signAllTransactions, signMessage]);
}

export const shortKey = (k: { toBase58(): string } | string) => {
  const s = typeof k === "string" ? k : k.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
