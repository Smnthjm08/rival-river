"use client";

import { useEffect, useRef } from "react";
import { CheckIcon, HourglassIcon, MonitorSmartphoneIcon, ShuffleIcon, TrophyIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, PINNED_ON_PHONES } from "@/components/rr/table/action-bar";
import { Felt, type SeatInfo } from "@/components/rr/table/felt";
import { MatchSidebar } from "@/components/rr/table/match-sidebar";
import { useSecondsLeft } from "@/components/rr/table-pieces";
import { cn } from "@/lib/utils";
import { useMatch } from "@/hooks/use-match";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { refundOpensAt, undelegate, type GameView, type Seat, type TableView } from "@/lib/rival";

const BETTING = new Set(["preflop", "flop", "turn", "river"]);

interface LiveTableProps {
  seat: Seat;
  table: TableView;
  seats: [SeatInfo, SeatInfo];
  busy: string | null;
  onCollect: () => void;
  onRefund: () => void;
  /** Called with each new snapshot, so the page header can show the hand and blinds. */
  onGame: (g: GameView) => void;
  /** The TEE refused this tab's login: the player has to sign in again. */
  onAuthLost: () => void;
  /** Another tab of the same wallet took this seat: take it back here. */
  onPlayHere: () => void;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The table while the game is on the rollup: felt, actions, and the side panel. */
export function LiveTable({ seat, table, seats, busy, onCollect, onRefund, onGame, onAuthLost, onPlayHere }: LiveTableProps) {
  const { game, hand, lastResult, results, act, acting, displaced } = useMatch(seat, onAuthLost);
  const me = seat.seat;
  const opp = (1 - me) as 0 | 1;
  const pastDeadline = useSecondsLeft(game?.matchDeadline ?? null) === 0;
  const refundIn = useSecondsLeft(refundOpensAt(table));

  useEffect(() => {
    if (game) onGame(game);
  }, [game, onGame]);

  // Match over, or out of time: the session key brings the game back to
  // Solana (no prompt). Collecting is then just the payout, and a refund
  // closes every account at once instead of stranding the rent on the
  // rollup. Both tabs may; the second one waits.
  const returning = useRef(false);
  const over = game?.phase === "finished" || pastDeadline;
  useEffect(() => {
    if (!over || returning.current) return;
    returning.current = true;
    undelegate(seat.session, seat).catch((e) => {
      console.warn("[rival] undelegate with the session key failed; Collect or Refund retries with the wallet", e);
      returning.current = false;
    });
  }, [over, seat]);

  if (!game) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="aspect-16/10 w-full rounded-[2.5rem] md:rounded-[50%]" />
        <Skeleton className="h-20 w-full rounded-[1.25rem]" />
      </div>
    );
  }

  let below: React.ReactNode;
  if (game.phase === "finished") {
    const iWon = game.winner === me;
    below = (
      <Card size="lg" className={cn("rounded-[1.25rem] border border-brass/45", PINNED_ON_PHONES)} role="dialog" aria-labelledby="match-over">
        <CardHeader>
          <CardTitle id="match-over" className="flex items-center gap-3 font-heading text-3xl font-extrabold tracking-tight">
            {iWon && <TrophyIcon aria-hidden="true" className="size-7 text-brass" />}
            {iWon ? "You won the match" : `${seats[opp].name} won the match`}
          </CardTitle>
          <CardDescription className="text-base/relaxed">
            <span className="font-mono font-semibold text-brass">{formatUsdc(table.stake * 2)} USDC</span>
            {iWon
              ? ` is waiting in escrow: your ${formatUsdc(table.stake)} USDC stake back plus your opponent’s ${formatUsdc(table.stake)}. Collect it to pay out.`
              : ` goes to ${seats[opp].name}. Either of you can send the payout.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="xl" className="w-full" onClick={onCollect} disabled={!!busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ?? (iWon ? "Collect winnings" : "Pay the winner")}
          </Button>
        </CardContent>
      </Card>
    );
  } else if (pastDeadline) {
    below = (
      <Alert variant="quiet" className={PINNED_ON_PHONES}>
        <HourglassIcon />
        <AlertTitle className="text-base">Play stopped at the two-hour mark</AlertTitle>
        <AlertDescription className="text-sm">
          {refundIn === 0 ? "Either player can now return both stakes." : `Either player can return both stakes in ${mmss(refundIn ?? 600)}.`}
        </AlertDescription>
        {refundIn === 0 && (
          <Button size="xl" className="col-start-2 mt-3 w-fit" onClick={onRefund} disabled={!!busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ?? "Refund both stakes"}
          </Button>
        )}
      </Alert>
    );
  } else if (game.phase === "dealing") {
    below = <ShuffleSteps hand={game.handNumber} secretIn={!!hand?.hasSecret} />;
  } else if (displaced) {
    below = (
      <Alert variant="quiet" className={PINNED_ON_PHONES}>
        <MonitorSmartphoneIcon />
        <AlertTitle className="text-base">This match is open in another tab</AlertTitle>
        <AlertDescription className="text-sm">
          Your seat is being played from another tab or browser, so this one is watching. Taking it back here asks your wallet
          once, and the other tab stops.
        </AlertDescription>
        <Button size="xl" className="col-start-2 mt-3 w-fit" onClick={onPlayHere} disabled={!!busy}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy ?? "Play here instead"}
        </Button>
      </Alert>
    );
  } else if (BETTING.has(game.phase)) {
    below = <ActionBar game={game} me={me} opponentName={seats[opp].name} acting={acting} onAct={act} />;
  } else {
    below = (
      <Alert variant="quiet" role="status">
        <ShuffleIcon />
        <AlertTitle className="text-base">{game.handNumber === 0 ? "Dealing the first hand" : "Next hand in a moment"}</AlertTitle>
        <AlertDescription className="text-sm">The button moves and the blinds go up every hand.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-wrap gap-6 max-md:pb-64">
      <section aria-label="Table" className="flex min-w-0 flex-[999_1_720px] flex-col gap-4.5">
        <Felt game={game} hand={hand} me={me} seats={seats} lastResult={lastResult} />
      </section>
      <MatchSidebar
        controls={below}
        game={game}
        me={me}
        names={[seats[0].name, seats[1].name]}
        stake={table.stake}
        keys={table.keys}
        results={results}
        lastResult={lastResult}
      />
    </div>
  );
}

/**
 * What the shuffle is waiting on, step by step. Each tick follows the chain:
 * your secret is in your Hand; the opponent's secret and the VRF answer
 * aren't visible to you, so that step spins until the cards arrive.
 */
export function ShuffleSteps({ hand, secretIn }: { hand: number; secretIn: boolean }) {
  const steps: { label: string; state: "done" | "now" | "later" }[] = [
    { label: "Blinds posted", state: "done" },
    { label: secretIn ? "Your secret is in" : "Adding your browser’s secret", state: secretIn ? "done" : "now" },
    { label: "Opponent’s secret + MagicBlock VRF", state: secretIn ? "now" : "later" },
    { label: "Dealt privately in the TEE", state: "later" },
  ];
  return (
    <Card size="lg" className="rounded-[1.25rem] border border-river/40" role="status">
      <CardContent className="flex flex-col gap-3.5">
        <span className="flex items-center gap-2 font-heading text-xl font-extrabold">
          <ShuffleIcon aria-hidden="true" className="size-5 text-river" />
          Shuffling hand {hand}
        </span>
        <ol className="flex flex-col gap-2.5">
          {steps.map((s) => (
            <li key={s.label} className={cn("flex items-center gap-2.5 text-[15px]", s.state === "later" && "text-muted-foreground")}>
              {s.state === "done" ? (
                <CheckIcon aria-hidden="true" className="size-4.5 text-river" strokeWidth={2.6} />
              ) : s.state === "now" ? (
                <Spinner className="size-4.5 text-brass" />
              ) : (
                <span aria-hidden="true" className="size-4.5 rounded-full border-2 border-foreground/20" />
              )}
              {s.label}
            </li>
          ))}
        </ol>
        <span className="text-[13px]/relaxed text-muted-foreground">
          Nobody can predict the deck: it mixes both players’ secrets with MagicBlock’s verifiable randomness.
        </span>
      </CardContent>
    </Card>
  );
}
