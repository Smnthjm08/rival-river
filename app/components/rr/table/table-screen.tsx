"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import { CopyIcon, LockIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { SiteHeader } from "@/components/rr/site-header";
import { CHARACTER_NAMES, charactersFor } from "@/components/rr/seat-avatar";
import { Eyebrow, useSecondsLeft } from "@/components/rr/table-pieces";
import { type SeatInfo } from "@/components/rr/table/felt";
import { LiveTable } from "@/components/rr/table/live-table";
import { explorer } from "@/components/rr/table/match-sidebar";
import { StakesReview, type StepState } from "@/components/rr/table/stakes-review";
import { WalletButton } from "@/components/rr/wallet-button";
import { useTable } from "@/hooks/use-table";
import { formatUsdc, useUsdcBalance } from "@/hooks/use-usdc-balance";
import { shortKey, useWalletSigner } from "@/hooks/use-wallet-signer";
import { friendlyError } from "@/lib/errors";
import {
  base,
  blindsFor,
  canSitSilently,
  cancelTable,
  clearTeeLogin,
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
  const { publicKey: connected } = useWallet();
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
    const wallets = [table.keys.creator, table.keys.opponent];
    return [0, 1].map((i) => ({
      character: chars[i],
      name: me === i ? "You" : CHARACTER_NAMES[chars[i]],
      address: shortKey(wallets[i]),
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

  // The creator's tab hears about the opponent joining, which also starts the match.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = table?.status ?? null;
    if (lastStatus.current === "waitingForOpponent" && status === "inPlay" && me === 0 && seats) {
      toast.success(`${seats[1].name} (${seats[1].address}) joined. The match is starting.`);
    }
    lastStatus.current = status;
  }, [table?.status, me, seats]);

  const takeSeat = useCallback(async () => {
    if (!wallet || !table) return;
    await run("Sitting down…", async () => setSeat(await enterRollup(wallet, table)));
  }, [wallet, table, run]);

  // Sit down by itself when it needs no prompt: this tab's session key was
  // named when staking, or it still holds a TEE login (a reload).
  const autoTried = useRef(false);
  useEffect(() => {
    const ready = onRollup && table && me !== null && !activeSeat && wallet && !busy && !autoTried.current;
    if (ready && (canSitSilently(table, wallet.publicKey) || hasTeeLogin(wallet.publicKey))) {
      autoTried.current = true;
      void takeSeat();
    }
  }, [onRollup, table, me, activeSeat, wallet, busy, takeSeat]);

  // The TEE refused the login token: forget it and sit down again.
  const authLost = useCallback(() => {
    if (!wallet) return;
    clearTeeLogin(wallet.publicKey);
    if (seat) clearTeeLogin(seat.session.publicKey);
    autoTried.current = false;
    setSeat(null);
    toast.info("Your sign-in to the private rollup expired. Signing in again…");
  }, [wallet, seat]);

  const collect = useCallback(() => {
    if (!wallet || !table) return;
    const winner = liveGame?.winner ?? gameOnSolana?.winner ?? null;
    void run("Paying out…", async () => {
      const signature = await finishMatch(wallet, { keys: table.keys, tee: activeSeat?.tee ?? base, session: activeSeat?.session });
      const result: FinalResult = { iWon: winner === null || me === null ? null : winner === me, amount: table.stake * 2, signature };
      sessionStorage.setItem(finalKey, JSON.stringify(result));
      setFinal(result);
    });
  }, [wallet, table, liveGame, gameOnSolana, run, activeSeat, me, finalKey]);

  const doRefund = useCallback(() => {
    if (!wallet || !table) return;
    void run("Returning both stakes…", () => refund(wallet, table.keys));
  }, [wallet, table, run]);

  const start = useCallback(() => {
    if (!wallet || !table) return;
    void run("Starting the match…", async () => {
      await startMatch(wallet, table.keys);
      setBusy("Opening the private table…");
      await waitForRollup(table.keys);
    });
  }, [wallet, table, run]);

  const refundIn = useSecondsLeft(table ? refundOpensAt(table) : null);
  const turnPill = useTurnPill(liveGame, activeSeat?.seat ?? null, seats);

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
  const [creator, opponent] = seats!;
  const inviteUrl = typeof location === "undefined" ? "" : location.href;

  const steps = (now: number): { label: string; state: StepState }[] =>
    [
      `${creator.name === "You" ? "You" : creator.name} opened the table and deposited`,
      `${opponent.name === "You" ? "You deposit" : `${opponent.name} deposits`}, and the match starts`,
      `Up to ${MAX_HANDS} hands on MagicBlock’s private rollup`,
      `Winner collects ${formatUsdc(table.stake * 2)} USDC`,
    ].map((label, i) => ({ label, state: i < now ? "done" : i === now ? "now" : "later" }));

  const layout = (left: React.ReactNode, now: number, pills?: React.ReactNode) => (
    <Shell pills={pills}>
      <div className="mx-auto flex max-w-6xl flex-wrap gap-10 py-6">
        <section className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">{left}</section>
        <section className="flex min-w-0 flex-[1_1_420px] flex-col">
          <StakesReview seats={seats!} stake={table.stake} opponentDeposited={now > 1} steps={steps(now)} />
        </section>
      </div>
    </Shell>
  );

  // ---- Before the opponent joins -----------------------------------------------
  if (table.status === "waitingForOpponent") {
    if (me === 0) {
      return layout(
        <>
          <Heading eyebrow="Table open" title={`Waiting for ${opponent.name}`}>
            Send this link to your friend. Only the wallet <Mono>{opponent.address}</Mono> can join. When they match your stake the match
            starts by itself, so keep this tab open.
          </Heading>
          <div className="flex flex-col gap-3 rounded-2xl bg-card p-4">
            <Eyebrow>Invite link</Eyebrow>
            <div className="flex flex-wrap gap-2.5">
              <Input readOnly value={inviteUrl} aria-label="Invite link" className="h-12 min-w-0 flex-[1_1_260px] font-mono text-sm" onFocus={(e) => e.currentTarget.select()} />
              <Button
                size="xl"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteUrl);
                  toast.success("Invite link copied");
                }}
              >
                <CopyIcon data-icon="inline-start" />
                Copy
              </Button>
            </div>
            <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-river" />
              {opponent.name} hasn’t joined yet
            </span>
          </div>
          <Button variant="outline" size="xl" className="w-fit" disabled={!!busy} onClick={() => void run("Cancelling…", () => cancelTable(wallet!, keys))}>
            {busy ?? "Cancel and take my stake back"}
          </Button>
        </>,
        1,
      );
    }
    if (me === 1) {
      return layout(<JoinPanel table={table} creator={creator} busy={busy} onJoin={() => void run("Confirm in your wallet…", () => joinTable(wallet!, keys))} />, 1);
    }
    return layout(<WrongWallet invited={opponent.address!} creatorName={creator.name} connected={connected} />, 1);
  }

  if (table.status === "refunded") {
    return (
      <Shell>
        <Notice title="Stakes returned" description="Both players got their stake back. The game’s accounts close once it’s back from the rollup." />
      </Shell>
    );
  }

  // ---- Finished and back on Solana: pay the winner ------------------------------
  if (gameOnSolana?.phase === "finished") {
    const iWon = gameOnSolana.winner === me;
    return (
      <Shell>
        <Notice
          title={me === null ? "Match finished" : iWon ? "You won the match" : `${opponent.name === "You" ? creator.name : opponent.name} won the match`}
          description={
            <>
              <span className="font-mono font-semibold text-brass">{formatUsdc(table.stake * 2)} USDC</span> is waiting in escrow for the winner.{" "}
              {iWon ? "One approval in your wallet pays it out." : "Either player can send the payout."}
            </>
          }
        >
          <Button size="xl" disabled={!wallet || !!busy} onClick={collect}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ?? (iWon ? "Collect winnings" : "Pay the winner")}
          </Button>
        </Notice>
      </Shell>
    );
  }

  // ---- Both staked, the game isn't on the rollup (yet) ---------------------------
  if (!onRollup) {
    const refundable = refundIn === 0;
    // Joining delegates the game in the same transaction; until the router
    // sees it, the game is owned by the delegation program and reads as null.
    const arriving = table.status === "inPlay" && !gameOnSolana;
    let body: React.ReactNode;
    if (refundable) {
      body = (
        <>
          <Heading eyebrow="Match didn’t start" title="Refund both stakes">
            The start deadline passed before the match reached the private rollup. Anyone can return both stakes now.
          </Heading>
          <Button size="2xl" className="w-fit" disabled={!wallet || !!busy} onClick={doRefund}>
            {busy ?? "Refund both stakes"}
          </Button>
        </>
      );
    } else if (arriving || busy) {
      body = (
        <Heading eyebrow="Both stakes in" title="Opening the private table" spinner>
          {busy ?? "Moving the game to MagicBlock’s private rollup. This takes a few seconds."}
        </Heading>
      );
    } else {
      body = (
        <>
          <Heading eyebrow="Both stakes in" title="Start the match">
            The game didn’t reach the private rollup yet. Either player can start it: one approval in the wallet.
          </Heading>
          {me !== null && (
            <Button size="2xl" className="w-fit" onClick={start}>
              Start the match
            </Button>
          )}
        </>
      );
    }
    return layout(body, 2);
  }

  // ---- On the rollup, this tab hasn't sat down ----------------------------------
  if (!activeSeat) {
    let body: React.ReactNode;
    if (me === null) {
      body = (
        <Heading eyebrow="Match in play" title="Players only">
          Only the two players can see this table. Connect <Mono>{creator.address}</Mono> or <Mono>{opponent.address}</Mono> to sit down.
        </Heading>
      );
    } else if (busy) {
      body = (
        <Heading eyebrow="Match ready" title="Sitting down" spinner>
          Signing in to the private rollup with this tab’s session key. No wallet prompt needed.
        </Heading>
      );
    } else if (wallet && canSitSilently(table, wallet.publicKey)) {
      // Normally sits down by itself; this shows only if that failed.
      body = (
        <>
          <Heading eyebrow="Match ready" title="Take your seat">
            This tab has your session key, so sitting down needs no wallet prompt.
          </Heading>
          <Button size="2xl" className="w-fit" onClick={() => void takeSeat()}>
            Sit down
          </Button>
        </>
      );
    } else {
      body = (
        <>
          <Heading eyebrow="Match ready" title="Take your seat">
            This tab doesn’t have your session key for this match (it was staked from another tab or browser). Sign in once; after that
            your moves need no approvals.
          </Heading>
          <Button size="2xl" className="w-fit" onClick={() => void takeSeat()}>
            Take your seat
          </Button>
        </>
      );
    }
    return layout(body, 2, <PrivatePill />);
  }

  // ---- Playing ------------------------------------------------------------------
  const g = liveGame;
  const [small, big] = blindsFor(g?.handNumber ?? 1);
  const pills = (
    <>
      {turnPill}
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
      <LiveTable seat={activeSeat} table={table} seats={seats!} busy={busy} onCollect={collect} onRefund={doRefund} onGame={setLiveGame} onAuthLost={authLost} />
    </Shell>
  );
}

/** Header pill and tab title saying whose turn it is, while betting. */
function useTurnPill(game: GameView | null, me: 0 | 1 | null, seats: [SeatInfo, SeatInfo] | null) {
  const betting = !!game && me !== null && ["preflop", "flop", "turn", "river"].includes(game.phase);
  const mine = betting && game!.toAct === me;
  const theirName = seats && me !== null ? seats[1 - me].name : "";
  useEffect(() => {
    const before = document.title;
    if (betting) document.title = mine ? "● Your turn · Rival River" : `${theirName}’s turn · Rival River`;
    return () => {
      document.title = before;
    };
  }, [betting, mine, theirName]);
  if (!betting) return null;
  return mine ? (
    <Badge variant="brass" size="lg" className="font-semibold">Your turn</Badge>
  ) : (
    <Badge variant="river" size="lg" className="font-semibold">{theirName}’s turn</Badge>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-foreground">{children}</span>;
}

function Heading({ eyebrow, title, spinner, children }: { eyebrow: string; title: string; spinner?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="flex items-center gap-3 font-heading text-5xl leading-none font-extrabold tracking-tight">
        {spinner && <Spinner className="size-8 text-river" />}
        {title}
      </h1>
      <p className="max-w-lg text-lg/relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** The invited wallet's view: who invited you, the stake, and one button. */
function JoinPanel({ table, creator, busy, onJoin }: { table: TableView; creator: SeatInfo; busy: string | null; onJoin: () => void }) {
  const wallet = useWalletSigner();
  const balance = useUsdcBalance(wallet?.publicKey ?? null);
  const short = balance !== null && balance < table.stake;
  return (
    <>
      <Heading eyebrow="You’re invited" title={`${creator.name} challenges you`}>
        <Mono>{creator.address}</Mono> staked <Mono>{formatUsdc(table.stake)} USDC</Mono>. Match it and the match starts right away: one
        approval in your wallet puts your stake in escrow and opens the private table. Winner takes{" "}
        <Mono>{formatUsdc(table.stake * 2)} USDC</Mono>.
      </Heading>
      {short && (
        <Alert variant="error">
          <AlertTitle>Not enough devnet USDC</AlertTitle>
          <AlertDescription>
            You have <Mono>{formatUsdc(balance!)} USDC</Mono>. Get some at{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-brass underline-offset-4 hover:underline">
              faucet.circle.com
            </a>{" "}
            (Solana devnet), plus a little devnet SOL for fees.
          </AlertDescription>
        </Alert>
      )}
      <Button size="2xl" className="w-fit" disabled={!!busy || short} onClick={onJoin}>
        {busy && <Spinner data-icon="inline-start" />}
        {busy ?? `Match ${formatUsdc(table.stake)} USDC and play`}
      </Button>
    </>
  );
}

/** Not connected, or connected with a wallet that isn't invited. */
function WrongWallet({ invited, creatorName, connected }: { invited: string; creatorName: string; connected: PublicKey | null }) {
  if (!connected) {
    return (
      <>
        <Heading eyebrow="You’re invited" title="Connect to join">
          {creatorName} invited the wallet <Mono>{invited}</Mono> to a heads-up match. Connect that wallet to see the stake and join.
        </Heading>
        <div className="w-fit">
          <WalletButton />
        </div>
      </>
    );
  }
  return (
    <Heading eyebrow="Wrong wallet" title="This invite is for another wallet">
      It’s for <Mono>{invited}</Mono>, and you’re connected as <Mono>{shortKey(connected)}</Mono>. Switch accounts in your wallet app; this
      page updates by itself.
    </Heading>
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
