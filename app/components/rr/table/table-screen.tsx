"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { CopyIcon, LockIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { SiteHeader } from "@/components/rr/site-header";
import { CHARACTER_NAMES, charactersFor } from "@/components/rr/seat-avatar";
import { Eyebrow, useSecondsLeft } from "@/components/rr/table-pieces";
import { type SeatInfo } from "@/components/rr/table/felt";
import { LiveTable } from "@/components/rr/table/live-table";
import { explorer } from "@/components/rr/table/match-sidebar";
import { StakesReview, type StepState } from "@/components/rr/table/stakes-review";
import { useTable } from "@/hooks/use-table";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { useWalletSigner } from "@/hooks/use-wallet-signer";
import { friendlyError } from "@/lib/errors";
import {
  base,
  blindsFor,
  cancelTable,
  enterRollup,
  finishMatch,
  hasTeeLogin,
  joinTable,
  matchKeys,
  MAX_HANDS,
  refund,
  refundOpensAt,
  seatOf,
  startMatch,
  waitForRollup,
  type GameView,
  type Seat,
  type TableView,
} from "@/lib/rival";

function parseRoute(p: { creator?: string; tableId?: string }) {
  try {
    if (!p.creator || !p.tableId || !/^\d+$/.test(p.tableId)) return null;
    const creator = new PublicKey(p.creator);
    const tableId = new BN(p.tableId);
    // The table address only depends on the creator and id.
    return { creator, tableId, table: matchKeys(creator, creator, tableId).table };
  } catch {
    return null;
  }
}

/** Reads the route, then hands over to the table flow. Rendered inside <Suspense>. */
export function TableScreen() {
  const params = useParams<{ creator: string; tableId: string }>();
  const route = useMemo(() => parseRoute(params), [params]);
  if (!route) {
    return (
      <Shell>
        <Notice title="That isn’t a table link" description="Check the invite link, or create a new table." />
      </Shell>
    );
  }
  return <TableFlow tablePda={route.table} />;
}

function Shell({ children, pills }: { children: React.ReactNode; pills?: React.ReactNode }) {
  return (
    <>
      <SiteHeader>{pills}</SiteHeader>
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-8 sm:pb-10">{children}</main>
    </>
  );
}

function Notice({ title, description, children }: { title: string; description: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Card size="lg" className="mx-auto mt-10 max-w-xl">
      <CardHeader>
        <CardTitle className="font-heading text-3xl font-extrabold tracking-tight">{title}</CardTitle>
        <CardDescription className="text-base/relaxed">{description}</CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-3">
        {children}
        <Button variant="outline" size="xl" nativeButton={false} render={<Link href="/" />}>
          Back to the lobby
        </Button>
      </CardFooter>
    </Card>
  );
}

/** What this tab saw at the end of the match, kept after settle closes the table. */
interface FinalResult {
  iWon: boolean | null;
  amount: number;
  signature: string | null;
}

function TableFlow({ tablePda }: { tablePda: PublicKey }) {
  const wallet = useWalletSigner();
  const { table, gameOnSolana, onRollup, refresh } = useTable(tablePda);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [liveGame, setLiveGame] = useState<GameView | null>(null);
  const finalKey = `rr:final:${tablePda.toBase58()}`;
  const [final, setFinal] = useState<FinalResult | null>(() =>
    typeof sessionStorage === "undefined" ? null : JSON.parse(sessionStorage.getItem(finalKey) ?? "null"),
  );

  const me = table && wallet ? seatOf(table.keys, wallet.publicKey) : null;
  // A seat belongs to the wallet that took it; switching wallets drops it.
  const activeSeat = seat && wallet && me === seat.seat ? seat : null;

  const seats = useMemo((): [SeatInfo, SeatInfo] | null => {
    if (!table) return null;
    const chars = charactersFor(table.keys.creator, table.keys.opponent);
    return [0, 1].map((i) => ({
      character: chars[i],
      name: me === i ? "You" : CHARACTER_NAMES[chars[i]],
    })) as [SeatInfo, SeatInfo];
  }, [table, me]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        console.warn("[rival]", e);
        toast.error(friendlyError(e));
      } finally {
        setBusy(null);
        void refresh();
      }
    },
    [refresh],
  );

  const takeSeat = useCallback(async () => {
    if (!wallet || !table) return;
    await run("Taking your seat…", async () => setSeat(await enterRollup(wallet, table.keys)));
  }, [wallet, table, run]);

  // A reload with this tab's TEE login still valid rejoins without any prompt.
  const autoTried = useRef(false);
  useEffect(() => {
    if (onRollup && me !== null && !activeSeat && wallet && !busy && !autoTried.current && hasTeeLogin(wallet.publicKey)) {
      autoTried.current = true;
      void takeSeat();
    }
  }, [onRollup, me, activeSeat, wallet, busy, takeSeat]);

  const collect = useCallback(() => {
    if (!wallet || !table) return;
    const winner = liveGame?.winner ?? gameOnSolana?.winner ?? null;
    void run("Paying out…", async () => {
      const signature = await finishMatch(wallet, { keys: table.keys, tee: activeSeat?.tee ?? base });
      const result: FinalResult = { iWon: winner === null || me === null ? null : winner === me, amount: table.stake * 2, signature };
      sessionStorage.setItem(finalKey, JSON.stringify(result));
      setFinal(result);
    });
  }, [wallet, table, liveGame, gameOnSolana, run, activeSeat, me, finalKey]);

  const doRefund = useCallback(() => {
    if (!wallet || !table) return;
    void run("Returning both stakes…", () => refund(wallet, table.keys));
  }, [wallet, table, run]);

  const refundIn = useSecondsLeft(table ? refundOpensAt(table) : null);

  // ---- Loading and closed tables ----------------------------------------------
  if (table === undefined) {
    return (
      <Shell>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12 w-72" />
          <Skeleton className="aspect-[16/10] w-full rounded-[2.5rem] md:rounded-[50%]" />
        </div>
      </Shell>
    );
  }
  if (table === null) {
    return (
      <Shell>
        {final ? (
          <Notice
            title={final.iWon === false ? "Match settled" : "Winnings paid"}
            description={
              <>
                <span className="font-mono font-semibold text-brass">{formatUsdc(final.amount)} USDC</span>
                {final.iWon === false ? " went to your opponent." : final.iWon ? " is in your wallet." : " went to the winner."} The table is closed.
              </>
            }
          >
            {final.signature && (
              <Button variant="secondary" size="xl" nativeButton={false} render={<a href={explorer("tx", final.signature)} target="_blank" rel="noreferrer" />}>
                View payout on Solana
              </Button>
            )}
          </Notice>
        ) : (
          <Notice
            title="This table is closed"
            description="It was settled, cancelled or refunded. Settled matches paid the winner; the others returned the stakes."
          />
        )}
      </Shell>
    );
  }

  const keys = table.keys;
  const inviteUrl = typeof location === "undefined" ? "" : location.href;
  const opponentName = seats![1].name;

  const steps = (now: number): { label: string; state: StepState }[] =>
    [
      "Table created",
      me === 1 ? "Creator deposited" : "You deposited",
      me === 1 ? "You deposit" : `${opponentName} deposits`,
      "Match starts on the private rollup",
      `Play up to ${MAX_HANDS} hands, winner is paid`,
    ].map((label, i) => ({ label, state: i < now ? "done" : i === now ? "now" : "later" }));

  // ---- Before the opponent joins -----------------------------------------------
  if (table.status === "waitingForOpponent") {
    return (
      <Shell>
        <div className="mx-auto flex max-w-6xl flex-wrap gap-10 py-6">
          <section className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Eyebrow>Waiting for your friend</Eyebrow>
              <h1 className="font-heading text-5xl leading-none font-extrabold tracking-tight">
                {me === 1 ? "You’re invited" : "Send the invite"}
              </h1>
              <p className="max-w-lg text-lg/relaxed text-muted-foreground">
                {me === 1
                  ? `Match the ${formatUsdc(table.stake)} USDC stake to sit down. It stays in escrow on Solana until the match ends.`
                  : me === 0
                    ? "Only the invited wallet can join. Until they do, you can cancel and take your stake back."
                    : "This table is for two specific wallets. Connect the invited wallet to join."}
              </p>
            </div>
            {me === 1 && (
              <Button size="2xl" className="w-fit" disabled={!!busy} onClick={() => void run("Confirm in your wallet", () => joinTable(wallet!, keys))}>
                {busy && <Spinner data-icon="inline-start" />}
                {busy ?? `Match ${formatUsdc(table.stake)} USDC`}
              </Button>
            )}
            {me === 0 && (
              <div className="flex flex-wrap gap-3">
                <Button
                  size="2xl"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteUrl);
                    toast.success("Invite link copied");
                  }}
                >
                  <CopyIcon data-icon="inline-start" />
                  Copy invite link
                </Button>
                <Button variant="outline" size="2xl" disabled={!!busy} onClick={() => void run("Cancelling…", () => cancelTable(wallet!, keys))}>
                  {busy ?? "Cancel and refund"}
                </Button>
              </div>
            )}
          </section>
          <section className="flex min-w-0 flex-[1_1_420px] flex-col">
            <StakesReview seats={seats!} stake={table.stake} opponentDeposited={false} steps={steps(2)} />
          </section>
        </div>
      </Shell>
    );
  }

  // ---- Both staked, before the game reaches the rollup ---------------------------
  if (table.status === "refunded") {
    return (
      <Shell>
        <Notice title="Stakes returned" description="Both players got their stake back. The game’s accounts close once it’s back from the rollup." />
      </Shell>
    );
  }

  const settleable = gameOnSolana?.phase === "finished";
  const preGame = table.status === "locked" || (!onRollup && !settleable);
  if (preGame || (onRollup && !activeSeat)) {
    const refundable = refundIn === 0;
    let action: React.ReactNode = null;
    if (refundable && !settleable) {
      action = (
        <Button size="2xl" className="w-fit" disabled={!wallet || !!busy} onClick={doRefund}>
          {busy ?? "Refund both stakes"}
        </Button>
      );
    } else if (onRollup && me !== null) {
      action = (
        <Button size="2xl" className="w-fit" disabled={!!busy} onClick={() => void takeSeat()}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy ?? "Take your seat"}
        </Button>
      );
    } else if (me === 0) {
      action = (
        <Button
          size="2xl"
          className="w-fit"
          disabled={!!busy}
          onClick={() =>
            void run("Starting the match…", async () => {
              await startMatch(wallet!, keys);
              setBusy("Moving to the private rollup…");
              await waitForRollup(keys);
              setBusy("Taking your seat…");
              setSeat(await enterRollup(wallet!, keys));
            })
          }
        >
          {busy && <Spinner data-icon="inline-start" />}
          {busy ?? "Start the match"}
        </Button>
      );
    }
    return (
      <Shell pills={onRollup && <PrivatePill />}>
        <div className="mx-auto flex max-w-6xl flex-wrap gap-10 py-6">
          <section className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Eyebrow>{onRollup ? "Match ready" : "Both stakes in"}</Eyebrow>
              <h1 className="font-heading text-5xl leading-none font-extrabold tracking-tight">
                {onRollup ? "Take your seat" : me === 0 ? "Start the match" : "Almost there"}
              </h1>
              <p className="max-w-lg text-lg/relaxed text-muted-foreground">
                {refundable && !settleable
                  ? "The deadline passed before the match finished. Anyone can return both stakes now."
                  : onRollup
                    ? me === null
                      ? "Only the two players can see this table. Connect a player’s wallet to sit down."
                      : "Sign in to the private rollup once, then a session key in this tab plays your moves: no wallet pop-up per action."
                    : me === 0
                      ? "One wallet prompt creates the game and moves it to MagicBlock’s private rollup, then you sign in and sit down."
                      : `Waiting for the creator to start.${refundIn ? ` If they don’t, both stakes can be returned in ${Math.ceil(refundIn / 60)} min.` : ""}`}
              </p>
            </div>
            {action}
          </section>
          <section className="flex min-w-0 flex-[1_1_420px] flex-col">
            <StakesReview seats={seats!} stake={table.stake} opponentDeposited steps={steps(onRollup ? 4 : 3)} />
          </section>
        </div>
      </Shell>
    );
  }

  // ---- Finished and back on Solana, not yet settled -----------------------------
  if (settleable && !activeSeat) {
    const iWon = gameOnSolana!.winner === me;
    return (
      <Shell>
        <Notice
          title={me === null ? "Match finished" : iWon ? "You won the match" : `${opponentName} won the match`}
          description={
            <>
              <span className="font-mono font-semibold text-brass">{formatUsdc(table.stake * 2)} USDC</span> is waiting in escrow for the winner. Anyone can send the payout.
            </>
          }
        >
          <Button size="xl" disabled={!wallet || !!busy} onClick={collect}>
            {busy ?? (iWon ? "Collect winnings" : "Pay the winner")}
          </Button>
        </Notice>
      </Shell>
    );
  }

  // ---- Playing ------------------------------------------------------------------
  const g = liveGame;
  const [small, big] = blindsFor(g?.handNumber ?? 1);
  const pills = (
    <>
      {g && g.handNumber > 0 && (
        <Badge variant="rail" size="lg" className="font-semibold">
          {g.handNumber > MAX_HANDS ? `Sudden death · hand ${g.handNumber}` : `Hand ${g.handNumber} of ${MAX_HANDS}`}
        </Badge>
      )}
      {g && g.handNumber > 0 && (
        <Badge variant="rail" size="lg">
          Blinds <span className="font-mono font-semibold">{small} / {big}</span>
        </Badge>
      )}
      <PrivatePill />
    </>
  );
  return (
    <Shell pills={pills}>
      <LiveTable seat={activeSeat!} table={table as TableView} seats={seats!} busy={busy} onCollect={collect} onRefund={doRefund} onGame={setLiveGame} />
    </Shell>
  );
}

function PrivatePill() {
  return (
    <Badge variant="river" size="lg" className="font-semibold">
      <LockIcon />
      Private rollup
    </Badge>
  );
}
