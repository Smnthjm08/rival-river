"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { MotionConfig } from "motion/react";
import { BASE_RPC } from "@/lib/rival";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Wallets are found through the Wallet Standard (Phantom, Solflare,
 * Backpack…), so no adapters are listed. The rival library opens its own
 * connections; ConnectionProvider is only here for wallet-adapter itself.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={BASE_RPC}>
      <WalletProvider wallets={[]} autoConnect>
        <TooltipProvider>
          {/* Card deals and flips skip their movement for "reduce motion". */}
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
          {/* Top of the screen: a toast must never cover the table's actions. */}
          <Toaster theme="dark" position="top-center" />
        </TooltipProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
