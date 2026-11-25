"use client";

import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { base, usdcAccount } from "@/lib/rival";

/**
 * The wallet's devnet USDC in base units (6 decimals): null while loading,
 * 0 when it has no USDC account yet.
 */
export function useUsdcBalance(owner: PublicKey | null): number | null {
  const [balance, setBalance] = useState<number | null>(null);
  useEffect(() => {
    if (!owner) return;
    let stop = false;
    const read = () =>
      getAccount(base, usdcAccount(owner))
        .then((a) => Number(a.amount))
        .catch(() => 0)
        .then((v) => !stop && setBalance(v));
    void read();
    const id = setInterval(read, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [owner]);
  return owner ? balance : null;
}

export const formatUsdc = (baseUnits: number) =>
  (baseUnits / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
