"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Eyebrow } from "@/components/rr/table-pieces";
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
    <main className="mx-auto flex w-full max-w-7xl flex-wrap gap-10 px-4 py-10 sm:px-8 sm:py-14">
      <section aria-labelledby="create-title" className="flex min-w-0 flex-[1_1_440px] flex-col gap-7">
        <div className="flex flex-col gap-3">
          <Eyebrow>New match</Eyebrow>
          <h1 id="create-title" className="font-heading text-5xl leading-none font-extrabold tracking-tight sm:text-6xl">
            Challenge a friend
          </h1>
          <p className="max-w-lg text-lg/relaxed text-muted-foreground">
            {MAX_HANDS} hands of heads-up hold’em. You both put in the same stake. The winner takes both.
          </p>
        </div>

        <Card size="lg">
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <FieldGroup className="gap-6">
                <FieldSet>
                  <FieldLegend className="text-sm">Who can join</FieldLegend>
                  <ToggleGroup
                    value={[who]}
                    onValueChange={(v) => v[0] && setWho(v[0] as "link" | "wallet")}
                    variant="stake"
                    size="xl"
                    spacing={2.5}
                    className="grid w-full grid-cols-2"
                  >
                    <ToggleGroupItem value="link" className="font-sans">Anyone with the link</ToggleGroupItem>
                    <ToggleGroupItem value="wallet" className="font-sans">A specific wallet</ToggleGroupItem>
                  </ToggleGroup>
                  {!named && (
                    <FieldDescription>
                      Whoever you send the invite link to can take the seat: the first to match your stake plays you.
                    </FieldDescription>
                  )}
                </FieldSet>

                {named && (
                  <Field data-invalid={!!addressError || undefined}>
                    <FieldLabel htmlFor="opponent" className="text-sm">Opponent’s wallet</FieldLabel>
                    <Input
                      id="opponent"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Paste a Solana address"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={!!addressError || undefined}
                      className="h-12 bg-ink px-4 font-mono text-[15px]"
                    />
                    {addressError ? <FieldError>{addressError}</FieldError> : <FieldDescription>Only this wallet can join your table.</FieldDescription>}
                  </Field>
                )}

                <FieldSet>
                  <FieldLegend className="text-sm">Stake per player</FieldLegend>
                  <ToggleGroup
                    value={[String(stake)]}
                    onValueChange={(v) => v[0] && setStake(Number(v[0]))}
                    variant="stake"
                    size="xl"
                    spacing={2.5}
                    className="grid w-full grid-cols-2 sm:grid-cols-4"
                  >
                    {STAKES.map((s) => (
                      <ToggleGroupItem key={s} value={String(s)} aria-label={`${s} USDC`}>
                        {s} USDC
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <FieldDescription>
                    Devnet USDC, held in escrow on Solana until the match ends.
                    {wallet && balance !== null && (
                      <>
                        {" "}You have <span className="font-mono text-foreground">{formatUsdc(balance)} USDC</span>
                        {shortOfUsdc && (
                          <>
                            {" "}— get more at{" "}
                            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-brass underline-offset-4 hover:underline">
                              faucet.circle.com
                            </a>
                          </>
                        )}
                        .
                      </>
                    )}
                  </FieldDescription>
                </FieldSet>

                <Button type="submit" size="2xl" disabled={!ready || shortOfUsdc || busy}>
                  {busy && <Spinner data-icon="inline-start" />}
                  {!wallet ? "Connect a wallet to create a table" : busy ? "Confirm in your wallet" : "Create table and copy invite link"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="how-title" className="flex min-w-0 flex-[1_1_440px] flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-title" className="font-heading text-3xl font-extrabold tracking-tight">Private cards, real stakes</h2>
        </div>

        <Card size="lg" className="bg-felt">
          <CardContent>
            <ol className="flex flex-col gap-4">
              {[
                "You create the table and stake.",
                "Your friend opens the invite link and matches the stake.",
                "Their one approval starts the match on MagicBlock’s private rollup.",
                `Play up to ${MAX_HANDS} hands. Blinds rise every hand, so it always ends.`,
                "The winner collects both stakes on Solana.",
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-3 text-[15px]/relaxed">
                  <span className="mt-0.5 flex size-6.5 shrink-0 items-center justify-center rounded-full border-2 border-mist/30 font-mono text-xs font-semibold">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card size="lg">
          <CardHeader>
            <CardTitle className="text-base">Who can see what</CardTitle>
            <CardDescription className="text-sm">Hands are played inside a TEE. Each account says who may read it.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {[
              "Your hole cards: only your wallet.",
              "The undealt deck: nobody, not even the players.",
              "The shuffle: MagicBlock VRF mixed with a secret from each of you.",
              "Folded hands: never revealed, even after the match.",
            ].map((line) => (
              <div key={line} className="flex items-start gap-2.5 text-sm/relaxed">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-river" strokeWidth={2.6} />
                <span>{line}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <p className="text-sm/relaxed text-muted-foreground">
          Until your friend joins, you can cancel and take your stake back. A match has two hours; if it stalls, play stops and ten minutes later either of you can return both stakes.
        </p>
      </section>
    </main>
  );
}
