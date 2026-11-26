"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import { CopyIcon, HourglassIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SiteHeader } from "@/components/rr/site-header";
import { CHARACTER_NAMES, charactersFor } from "@/components/rr/seat-avatar";
import { MatchStatus, PrivateStatus, useSecondsLeft } from "@/components/rr/table-pieces";
import { type SeatInfo } from "@/components/rr/table/felt";
import { LiveTable } from "@/components/rr/table/live-table";
import { CardGroup, explorer } from "@/components/rr/table/match-sidebar";
import { StakesReview, type StepState } from "@/components/rr/table/stakes-review";
import { TableSkeleton } from "@/components/rr/table/table-stage";
import { WalletButton } from "@/components/rr/wallet-button";
import { useTable } from "@/hooks/use-table";
import { formatUsdc, useUsdcBalance } from "@/hooks/use-usdc-balance";
import { shortKey, useWalletSigner } from "@/hooks/use-wallet-signer";
import { friendlyError } from "@/lib/errors";
import {
  base,
  canSitSilently,
  cancelTable,
  clearTeeLogin,
  enterRollup,
  finishMatch,
  hasTeeLogin,
  inviteFragment,
  inviteFromHash,
  savedInvite,
  joinTable,
  matchKeys,
  MAX_HANDS,
  closeRefunded,
  refund,
  teeConnection,
  undelegate,
  refundOpensAt,
  seatOf,
  startMatch,
  waitForRollup,
  type GameView,
  type Seat,
  type TableView,
} from "@/lib/rival";
import { cn } from "@/lib/utils";

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

/** `table`: the felt screen, which runs closer to the edges and fills the height. */
function Shell({ children, pills, table }: { children: React.ReactNode; pills?: React.ReactNode; table?: boolean }) {
  return (
    <>
      <SiteHeader quiet>{pills}</SiteHeader>
      <main className={cn("mx-auto w-full max-w-360", table ? "px-2 sm:px-4" : "px-4 py-6 sm:px-8 sm:py-10")}>{children}</main>
    </>
  );
}

/**
 * How the match's last hand ended. The table itself goes away within seconds,
 * when the game returns to Solana, so the result screens repeat it.
 */
function FinalHand({ game, viewer }: { game: GameView; viewer: PublicKey | null }) {
  // Named from the game itself: the table may already be closed.
  const chars = charactersFor(...game.players);
  const name = (i: 0 | 1) => (viewer?.equals(game.players[i]) ? "You" : CHARACTER_NAMES[chars[i]]);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-heading text-base font-bold">Final hand, hand {game.handNumber}</h2>
      {game.shown && (
        <>
          <CardGroup label="Board" cards={game.board} />
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <CardGroup label={name(0)} cards={game.shown[0]} />
            <CardGroup label={name(1)} cards={game.shown[1]} />
          </div>
        </>
      )}
      {!game.shown && <span className="text-sm text-muted-foreground">It ended with a fold, so no cards were shown.</span>}
    </div>
  );
}

function Notice({
  title,
  description,
  detail,
  children,
}: {
  title: string;
  description: React.ReactNode;
  detail?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-5 rounded-3xl bg-card p-5 sm:mt-8 sm:p-8">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="text-base/relaxed text-muted-foreground">{description}</p>
      </div>
      {detail && <div className="border-t pt-5">{detail}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {children}
        <Button variant="outline" size="xl" nativeButton={false} render={<Link href="/" />}>
          Back to the lobby
        </Button>
      </div>
    </div>
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
  const { table, gameOnSolana, onRollup, wrongRollup, refresh } = useTable(tablePda);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [liveGame, setLiveGame] = useState<GameView | null>(null);
  const finalKey = `rr:final:${tablePda.toBase58()}`;
  const [final, setFinal] = useState<FinalResult | null>(() =>
    typeof sessionStorage === "undefined" ? null : JSON.parse(sessionStorage.getItem(finalKey) ?? "null"),
  );

  const me = table && wallet ? seatOf(table.keys, wallet.publicKey) : null;
  const [linkInvite] = useState(() => (typeof location === "undefined" ? null : inviteFromHash(location.hash)));
  // A seat belongs to the wallet that took it; switching wallets drops it.
  const activeSeat = seat && wallet && me === seat.seat ? seat : null;

  const seats = useMemo((): [SeatInfo, SeatInfo] | null => {
    if (!table) return null;
    const chars = charactersFor(table.keys.creator, table.keys.opponent);
    const wallets = [table.keys.creator, table.keys.opponent];
    return [0, 1].map((i) =>
      i === 1 && table.open
        ? { character: chars[1], name: "Open seat" }
        : {
            character: chars[i],
            name: me === i ? "You" : CHARACTER_NAMES[chars[i]],
            address: shortKey(wallets[i]),
          }
    ) as [SeatInfo, SeatInfo];
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

  // Another tab of this wallet took the seat: register this tab's key again.
  const playHere = useCallback(() => {
    if (!wallet || !table) return;
    void run("Taking your seat back…", async () => setSeat(await enterRollup(wallet, table)));
  }, [wallet, table, run]);

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
  // In play: seconds until the two-hour mark, when play stops.
  const playEndsIn = useSecondsLeft(table?.status === "inPlay" ? table.deadline : null);

  // A refund while the game was still on the rollup leaves the Table open:
  // bring the game back, then close it (rent to the creator).
  const closeLeftovers = useCallback(() => {
    if (!wallet || !table) return;
    void run("Closing the table…", async () => {
      const tee = activeSeat?.tee ?? (await teeConnection(wallet));
      await undelegate(activeSeat?.session ?? wallet, { keys: table.keys, tee });
      await closeRefunded(wallet, table.keys);
    });
  }, [wallet, table, activeSeat, run]);
  useTurnTitle(liveGame, activeSeat?.seat ?? null, seats);

  // The finished game, from Solana or as this tab last saw it on the rollup.
  // It outlives the table, which settle closes.
  const finalGame = [gameOnSolana, liveGame].find((g) => g?.phase === "finished");
  const finalHand = finalGame && <FinalHand game={finalGame} viewer={wallet?.publicKey ?? null} />;

  // ---- Loading and closed tables ----------------------------------------------
  if (table === undefined) {
    return (
      <Shell table>
        <TableSkeleton />
      </Shell>
    );
  }
  if (table === null) {
    return (
      <Shell>
        {final ? (
          <Notice
            title={final.iWon === false ? "Match settled" : "Winnings paid"}
            detail={finalHand}
            description={
              <>
                <span className="font-mono font-semibold text-brass">{formatUsdc(final.amount)} USDC</span>
                {final.iWon === false
                  ? " went to your opponent."
                  : final.iWon
                    ? ` is in your wallet: your stake back plus ${formatUsdc(final.amount / 2)} USDC from your opponent.`
                    : " went to the winner."}{" "}
                The table is closed.
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
            detail={finalHand}
            description="It was settled, cancelled or refunded. Settled matches paid the winner; the others returned the stakes."
          />
        )}
      </Shell>
    );
  }

  const keys = table.keys;
  const [creator, opponent] = seats!;
  // Open tables: the link must carry the invite secret. The creator's copy is
  // in the URL they landed on, or saved when they created the table.
  const creatorInvite = table.open ? (linkInvite ?? savedInvite(table.keys.table)) : null;
  const inviteUrl =
    typeof location === "undefined"
      ? ""
      : `${location.origin}${location.pathname}${creatorInvite ? `#${inviteFragment(creatorInvite)}` : ""}`;
  const linkOk = !!linkInvite && !!table.inviteKey && linkInvite.publicKey.equals(table.inviteKey);

  const steps = (now: number): { label: string; state: StepState }[] =>
    [
      `${creator.name === "You" ? "You" : creator.name} opened the table and deposited`,
      `${opponent.name === "You" ? "You deposit" : table.open ? "Your friend deposits" : `${opponent.name} deposits`}, and the match starts`,
      `Up to ${MAX_HANDS} hands on MagicBlock’s private rollup`,
      `Winner collects ${formatUsdc(table.stake * 2)} USDC`,
    ].map((label, i) => ({ label, state: i < now ? "done" : i === now ? "now" : "later" }));

  const layout = (left: React.ReactNode, now: number, pills?: React.ReactNode) => (
    <Shell pills={pills}>
      <div className="mx-auto grid max-w-xl gap-8 lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-start lg:gap-16 lg:py-4">
        <section className="flex min-w-0 flex-col gap-6">{left}</section>
        <section className="min-w-0">
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
          {table.open ? (
            <Heading title="Send the invite link">
              Whoever you send this link to can take the seat: the first wallet to match your stake plays you. The match starts by
              itself, so keep this tab open.
            </Heading>
          ) : (
            <Heading title={`Waiting for ${opponent.name}`}>
              Send this link to your friend. Only the wallet <Mono>{opponent.address}</Mono> can join. When they match your stake the
              match starts by itself, so keep this tab open.
            </Heading>
          )}
          {table.open && !creatorInvite && (
            <Alert variant="error">
              <AlertTitle>This browser doesn’t have the invite link</AlertTitle>
              <AlertDescription>
                It was created in another browser. Copy the link from there, or cancel and create a new table.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="invite-link" className="text-sm font-medium">Invite link</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="invite-link" readOnly value={inviteUrl} aria-label="Invite link" className="font-mono text-sm sm:flex-1" onFocus={(e) => e.currentTarget.select()} />
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
              <HourglassIcon aria-hidden="true" className="size-4 shrink-0 text-river" />
              {table.open ? "Nobody has joined yet" : `${opponent.name} hasn’t joined yet`}
            </span>
          </div>
          <Button variant="outline" size="xl" className="w-full sm:w-fit" disabled={!!busy} onClick={() => void run("Cancelling…", () => cancelTable(wallet!, keys))}>
            {busy ?? "Cancel and take my stake back"}
          </Button>
        </>,
        1,
      );
    }
    const join = (invite: Keypair | null) => () => void run("Confirm in your wallet…", () => joinTable(wallet!, table, invite));
    if (me === 1) {
      return layout(<JoinPanel table={table} creator={creator} busy={busy} onJoin={join(null)} />, 1);
    }
    if (table.open) {
      if (!linkOk) {
        return layout(
          <Heading title="This link is missing its invite code">
            Ask your friend to send the whole link: the part after <Mono>#</Mono> is the key that lets you join.
          </Heading>,
          1,
        );
      }
      if (!connected) {
        return layout(
          <>
            <Heading title={`${creator.name} challenges you`}>
              <Mono>{creator.address}</Mono> opened a heads-up match for <Mono>{formatUsdc(table.stake)} USDC</Mono> a side. Connect a
              wallet to take the seat.
            </Heading>
            <div className="w-fit">
              <WalletButton />
            </div>
          </>,
          1,
        );
      }
      return layout(<JoinPanel table={table} creator={creator} busy={busy} onJoin={join(linkInvite)} />, 1);
    }
    return layout(<WrongWallet invited={opponent.address!} creatorName={creator.name} connected={connected} />, 1);
  }

  if (table.status === "refunded") {
    return (
      <Shell>
        <Notice
          title="Stakes returned"
          description="Both players got their stake back. The game was still on the private rollup, so the table is still open: either player can close it, and its rent goes back to the creator."
        >
          {me !== null && (
            <Button size="xl" disabled={!!busy} onClick={closeLeftovers}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ?? "Close the table"}
            </Button>
          )}
        </Notice>
      </Shell>
    );
  }

  // ---- The router put the game somewhere other than the private rollup -----------
  if (wrongRollup) {
    return (
      <Shell>
        <Notice
          title="The game is on an unexpected rollup"
          description="The router says this game is delegated somewhere other than MagicBlock’s private TEE rollup, so the app won’t send it anything. Your stakes are still in the escrow on Solana; after the deadline either player can refund them."
        />
      </Shell>
    );
  }

  // ---- Finished and back on Solana: pay the winner ------------------------------
  if (gameOnSolana?.phase === "finished") {
    const iWon = gameOnSolana.winner === me;
    return (
      <Shell>
        <Notice
          detail={finalHand}
          title={me === null ? "Match finished" : iWon ? "You won the match" : `${opponent.name === "You" ? creator.name : opponent.name} won the match`}
          description={
            <>
              <span className="font-mono font-semibold text-brass">{formatUsdc(table.stake * 2)} USDC</span> is waiting in escrow for the winner.{" "}
              {iWon
                ? `That’s your ${formatUsdc(table.stake)} USDC stake back plus your opponent’s ${formatUsdc(table.stake)}. One approval in your wallet pays it out.`
                : "Either player can send the payout."}
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
          {table.status === "inPlay" && gameOnSolana ? (
            <Heading title="Refund both stakes">
              The match didn’t finish within two hours. Anyone can return both stakes now.
            </Heading>
          ) : (
            <Heading title="Refund both stakes">
              The start deadline passed before the match reached the private rollup. Anyone can return both stakes now.
            </Heading>
          )}
          <Button size="2xl" className="w-full sm:w-fit" disabled={!wallet || !!busy} onClick={doRefund}>
            {busy ?? "Refund both stakes"}
          </Button>
        </>
      );
    } else if (table.status === "inPlay" && gameOnSolana && playEndsIn === 0) {
      // Out of time and back on Solana: nothing to start, wait for the refund.
      body = (
        <Heading title="Play stopped at the two-hour mark">
          The match didn’t finish in time, so no more hands can be played. Either player can return both stakes
          {refundIn ? ` in ${Math.floor(refundIn / 60)}:${String(refundIn % 60).padStart(2, "0")}` : " in a moment"}.
        </Heading>
      );
    } else if (arriving || busy) {
      // Same in-between state when the game comes back after the match.
      const leaving = liveGame?.phase === "finished" || playEndsIn === 0;
      body = leaving ? (
        <>
          <Heading title="Bringing the game back to Solana" spinner>
            {busy ?? "The cards and secrets are wiped, then the result lands on Solana. This takes a few seconds."}
          </Heading>
          {finalHand}
        </>
      ) : (
        <Heading title="Opening the private table" spinner>
          {busy ?? "Moving the game to MagicBlock’s private rollup. This takes a few seconds."}
        </Heading>
      );
    } else {
      body = (
        <>
          <Heading title="Start the match">
            The game didn’t reach the private rollup yet. Either player can start it: one approval in the wallet.
          </Heading>
          {me !== null && (
            <Button size="2xl" className="w-full sm:w-fit" onClick={start}>
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
        <Heading title="Players only">
          Only the two players can see this table. Connect <Mono>{creator.address}</Mono> or <Mono>{opponent.address}</Mono> to sit down.
        </Heading>
      );
    } else if (busy) {
      body = (
        <Heading title="Sitting down" spinner>
          Signing in to the private rollup with this tab’s session key. No wallet prompt needed.
        </Heading>
      );
    } else if (wallet && canSitSilently(table, wallet.publicKey)) {
      // Normally sits down by itself; this shows only if that failed.
      body = (
        <>
          <Heading title="Take your seat">
            This tab has your session key, so sitting down needs no wallet prompt.
          </Heading>
          <Button size="2xl" className="w-full sm:w-fit" onClick={() => void takeSeat()}>
            Sit down
          </Button>
        </>
      );
    } else {
      body = (
        <>
          <Heading title="Take your seat">
            This tab doesn’t have your session key for this match (it was staked from another tab or browser). Sign in once; after that
            your moves need no approvals.
          </Heading>
          <Button size="2xl" className="w-full sm:w-fit" onClick={() => void takeSeat()}>
            Take your seat
          </Button>
        </>
      );
    }
    return layout(body, 2, <PrivateStatus />);
  }

  // ---- Playing ------------------------------------------------------------------
  return (
    <Shell
      table
      pills={
        <>
          <MatchStatus stake={table.stake} handNumber={liveGame?.handNumber ?? 0} />
          <PrivateStatus />
        </>
      }
    >
      <LiveTable seat={activeSeat} table={table} seats={seats!} busy={busy} onCollect={collect} onRefund={doRefund} onGame={setLiveGame} onAuthLost={authLost} onPlayHere={playHere} />
    </Shell>
  );
}

/** Tab title saying whose turn it is, while betting. */
function useTurnTitle(game: GameView | null, me: 0 | 1 | null, seats: [SeatInfo, SeatInfo] | null) {
  const betting = !!game && me !== null && ["preflop", "flop", "turn", "river"].includes(game.phase);
  const mine = betting && game!.toAct === me;
  const theirName = seats && me !== null ? seats[1 - me].name : "";
  useEffect(() => {
    const before = document.title;
    // The dot is the one cue a background tab can show.
    if (betting) document.title = mine ? "● Your turn | Rival River" : `${theirName}’s turn | Rival River`;
    return () => {
      document.title = before;
    };
  }, [betting, mine, theirName]);
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-foreground">{children}</span>;
}

function Heading({ title, spinner, children }: { title: string; spinner?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="flex items-start gap-3 font-heading text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl">
        {spinner && <Spinner className="mt-1 size-7 shrink-0 text-river sm:mt-1.5" />}
        <span>{title}</span>
      </h1>
      <p className="max-w-lg text-base/relaxed text-muted-foreground">{children}</p>
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
      <Heading title={`${creator.name} challenges you`}>
        <Mono>{creator.address}</Mono> staked <Mono>{formatUsdc(table.stake)} USDC</Mono>. Match it and the match starts right away: one
        approval in your wallet puts your stake in escrow and opens the private table. Winner takes{" "}
        <Mono>{formatUsdc(table.stake * 2)} USDC</Mono>.
      </Heading>
      {short && (
        <Alert variant="error">
          <AlertTitle>Not enough devnet USDC</AlertTitle>
          <AlertDescription>
            You have <Mono>{formatUsdc(balance!)} USDC</Mono>. Get some at{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-4">
              faucet.circle.com
            </a>{" "}
            (Solana devnet), plus a little devnet SOL for fees.
          </AlertDescription>
        </Alert>
      )}
      <Button size="2xl" className="w-full sm:w-fit" disabled={!!busy || short} onClick={onJoin}>
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
        <Heading title="Connect to join">
          {creatorName} invited the wallet <Mono>{invited}</Mono> to a heads-up match. Connect that wallet to see the stake and join.
        </Heading>
        <div className="w-fit">
          <WalletButton />
        </div>
      </>
    );
  }
  return (
    <Heading title="This invite is for another wallet">
      It’s for <Mono>{invited}</Mono>, and you’re connected as <Mono>{shortKey(connected)}</Mono>. Switch accounts in your wallet app; this
      page updates by itself.
    </Heading>
  );
}
