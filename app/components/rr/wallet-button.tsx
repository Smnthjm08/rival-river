"use client";

import { useState } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { CopyIcon, LogOutIcon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortKey } from "@/hooks/use-wallet-signer";

/**
 * Wallet control: connect dialog, or the address with copy/disconnect.
 * `compact` shortens it on phones (the header); `quiet` leaves brass to the
 * screen's own main action.
 */
export function WalletButton({ compact, quiet }: { compact?: boolean; quiet?: boolean }) {
  const { wallets, select, publicKey, disconnect, connecting } = useWallet();
  const [open, setOpen] = useState(false);

  if (publicKey) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="pill" className="font-mono max-sm:px-3" />}>
          <WalletIcon aria-hidden="true" className={compact ? "max-sm:hidden" : undefined} />
          {shortKey(publicKey)}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(publicKey.toBase58());
                toast.success("Address copied");
              }}
            >
              <CopyIcon />
              Copy address
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void disconnect()}>
              <LogOutIcon />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const usable = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={quiet ? "outline" : "default"} size="pill" className="font-semibold max-sm:px-3" disabled={connecting} />}
      >
        <WalletIcon data-icon="inline-start" />
        <span>
          {connecting ? (
            "Connecting…"
          ) : (
            <>
              Connect<span className={compact ? "max-sm:sr-only" : undefined}> wallet</span>
            </>
          )}
        </span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a wallet</DialogTitle>
          <DialogDescription>Rival River runs on Solana devnet. Your wallet signs your stake and the payout; the game itself runs on a session key.</DialogDescription>
        </DialogHeader>
        {usable.length ? (
          <div className="flex flex-col gap-2">
            {usable.map((w) => (
              <Button
                key={w.adapter.name}
                variant="outline"
                size="xl"
                className="justify-start"
                onClick={() => {
                  select(w.adapter.name);
                  setOpen(false);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs from the wallet itself */}
                <img src={w.adapter.icon} alt="" className="size-6 rounded-md" />
                {w.adapter.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Solana wallet found in this browser. Install Phantom, Solflare or Backpack, switch it to devnet, then reload.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
