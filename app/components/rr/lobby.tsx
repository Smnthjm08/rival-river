"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatUsdc, useUsdcBalance } from "@/hooks/use-usdc-balance";
import { useWalletSigner } from "@/hooks/use-wallet-signer";
import { friendlyError } from "@/lib/errors";
import { createTable, inviteFragment, MAX_HANDS, USDC_DECIMALS } from "@/lib/rival";

const STAKES = [1, 5, 10, 25];

export const tablePath = (creator: PublicKey, tableId: { toString(): string }) => `/table/${creator.toBase58()}/${tableId.toString()}`;

function parseAddress(s: string): PublicKey | null {
  try {
    return s.trim() ? new PublicKey(s.trim()) : null;
  } catch {
    return null;
  }
}

export function Lobby() {
  const router = useRouter();
  const wallet = useWalletSigner();
  const balance = useUsdcBalance(wallet?.publicKey ?? null);
  const [address, setAddress] = useState("");
  // Open by default: whoever you send the link to can join.
  const [who, setWho] = useState<"link" | "wallet">("link");
  const [stake, setStake] = useState(5);
  const [busy, setBusy] = useState(false);

  const named = who === "wallet";
  const opponent = named ? parseAddress(address) : null;
  const addressError = !named
    ? null
    : address.trim() && !opponent
    ? "That isn’t a Solana address."
    : opponent && wallet && opponent.equals(wallet.publicKey)
      ? "You can’t invite yourself."
      : null;
  const stakeUnits = stake * 10 ** USDC_DECIMALS;
  const shortOfUsdc = balance !== null && balance < stakeUnits;

  const ready = !!wallet && (!named || (!!opponent && !addressError));

  async function create() {
    if (!wallet || !ready) return;
    setBusy(true);
    try {
      const { keys, invite } = await createTable(wallet, opponent, stakeUnits);
      // Open tables: the invite secret rides in the #fragment, never sent to a server.
      const path = tablePath(keys.creator, keys.tableId) + (invite ? `#${inviteFragment(invite)}` : "");
      await navigator.clipboard.writeText(`${location.origin}${path}`).catch(() => undefined);
      toast.success("Table created. Invite link copied: send it to your friend.");
      router.push(path);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      <section aria-labelledby="create-title" className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 id="create-title" className="font-heading text-4xl leading-none font-extrabold tracking-tight sm:text-5xl">
            Challenge a friend
          </h1>
          <p className="text-base/relaxed text-muted-foreground">
            {MAX_HANDS} hands of heads-up hold’em. You both put in the same stake. The winner takes both.
          </p>
        </div>

        {/* A panel from tablet up; on a phone the form is the screen itself. */}
        <form
          className="sm:rounded-3xl sm:bg-card sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <FieldGroup className="gap-5">
            <FieldSet className="gap-2">
              <FieldLegend>Who can join</FieldLegend>
              <ToggleGroup
                value={[who]}
                onValueChange={(v) => v[0] && setWho(v[0] as "link" | "wallet")}
                variant="choice"
                size="xl"
                spacing={2}
                className="grid w-full grid-cols-1 min-[26rem]:grid-cols-2"
              >
                <ToggleGroupItem value="link" className="h-auto min-h-12 py-2 text-[15px] whitespace-normal">Anyone with the link</ToggleGroupItem>
                <ToggleGroupItem value="wallet" className="h-auto min-h-12 py-2 text-[15px] whitespace-normal">A specific wallet</ToggleGroupItem>
              </ToggleGroup>
              {!named && (
                <FieldDescription className="mt-0!">
                  Whoever you send the invite link to can take the seat: the first to match your stake plays you.
                </FieldDescription>
              )}
            </FieldSet>

            {named && (
              <Field data-invalid={!!addressError || undefined}>
                <FieldLabel htmlFor="opponent">Opponent’s wallet</FieldLabel>
                <Input
                  id="opponent"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Paste a Solana address"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!addressError || undefined}
                  className="font-mono"
                />
                {addressError ? <FieldError>{addressError}</FieldError> : <FieldDescription>Only this wallet can join your table.</FieldDescription>}
              </Field>
            )}

            <FieldSet className="gap-2">
              <FieldLegend>Stake per player</FieldLegend>
              <ToggleGroup
                value={[String(stake)]}
                onValueChange={(v) => v[0] && setStake(Number(v[0]))}
                variant="stake"
                size="xl"
                spacing={2}
                className="grid w-full grid-cols-4"
              >
                {STAKES.map((s) => (
                  <ToggleGroupItem key={s} value={String(s)} aria-label={`${s} USDC`} className="h-12 min-w-0 px-1 text-sm sm:text-base">
                    {s} USDC
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldDescription className="mt-0!">
                Devnet USDC, held in escrow on Solana until the match ends.
                {wallet && balance !== null && (
                  <span className={shortOfUsdc ? "text-fold" : undefined}>
                    {" "}You have <span className="font-mono text-foreground">{formatUsdc(balance)} USDC</span>
                    {shortOfUsdc && (
                      <>
                        . Get more at{" "}
                        <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
                          faucet.circle.com
                        </a>
                      </>
                    )}
                    .
                  </span>
                )}
              </FieldDescription>
            </FieldSet>

            <Button type="submit" size="2xl" className="h-auto min-h-14 w-full px-3 py-2 text-[15px] whitespace-normal sm:text-lg" disabled={!ready || shortOfUsdc || busy}>
              {busy && <Spinner data-icon="inline-start" />}
              {!wallet ? "Connect a wallet to create a table" : busy ? "Confirm in your wallet" : "Create table and copy invite link"}
            </Button>
          </FieldGroup>
        </form>

        <p className="text-sm/relaxed text-muted-foreground">
          Until your friend joins, you can cancel and take your stake back. A match has two hours; if it stalls, play stops and ten minutes later either of you can return both stakes.
        </p>
      </section>

      <section aria-labelledby="how-title" className="border-b">
        <Disclosure id="how-title" title="How it works">
          <ol className="flex flex-col gap-3">
            {[
              "You create the table and stake.",
              "Your friend opens the invite link and matches the stake.",
              "Their one approval starts the match on MagicBlock’s private rollup.",
              `Play up to ${MAX_HANDS} hands. Blinds rise every hand, so it always ends.`,
              "The winner collects both stakes on Solana.",
            ].map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-sm/relaxed">
                <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Disclosure>

        <Disclosure title="Who can see what">
          <p className="mb-3 text-sm/relaxed text-muted-foreground">Hands are played inside a TEE. Each account says who may read it.</p>
          <ul className="flex flex-col gap-2.5">
            {[
              "Your hole cards: only your wallet.",
              "The undealt deck: nobody, not even the players.",
              "The shuffle: MagicBlock VRF mixed with a secret from each of you.",
              "Folded hands: never revealed, even after the match.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm/relaxed">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-river" strokeWidth={2.6} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </section>
    </main>
  );
}

/** Secondary reading, closed until asked for. */
function Disclosure({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <details className="group border-t">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-md [&::-webkit-details-marker]:hidden">
        <h2 id={id} className="font-semibold">{title}</h2>
        <ChevronDownIcon aria-hidden="true" className="size-4.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="pt-1 pb-5">{children}</div>
    </details>
  );
}
