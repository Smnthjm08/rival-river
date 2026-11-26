"use client";

import { useEffect, useRef } from "react";
import { CheckIcon, CircleDashedIcon, HourglassIcon, MonitorSmartphoneIcon, ShuffleIcon, TrophyIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar } from "@/components/rr/table/action-bar";
import { Felt, type SeatInfo } from "@/components/rr/table/felt";
import { MatchSidebar } from "@/components/rr/table/match-sidebar";
import { TableSkeleton } from "@/components/rr/table/table-stage";
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

// A status in the dock: one row on wide screens, its button at the end.
const DOCK_ALERT = "content-center md:has-[>svg]:grid-cols-[auto_minmax(0,1fr)_auto] md:has-[>svg]:gap-x-4";
const DOCK_BUTTON = "col-start-2 mt-3 w-fit md:col-start-3 md:row-span-2 md:row-start-1 md:mt-0 md:self-center";

/** The table while the game is on the rollup: felt, actions, and the match details. */
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
  // closes the table at once instead of leaving it open until the game is
  // back. Both tabs may; the second one waits.
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

  if (!game) return <TableSkeleton />;

  let below: React.ReactNode;
  if (game.phase === "finished") {
    const iWon = game.winner === me;
    below = (
      <div
        className="flex flex-col justify-center gap-3 rounded-2xl border border-brass/45 bg-card p-4 md:flex-row md:items-center md:justify-between md:gap-8 md:px-5"
        role="dialog"
        aria-labelledby="match-over"
      >
        <div className="flex flex-col gap-1">
          <h2 id="match-over" className="flex items-center gap-2.5 font-heading text-2xl font-extrabold tracking-tight">
            {iWon && <TrophyIcon aria-hidden="true" className="size-6 shrink-0 text-brass" />}
            {iWon ? "You won the match" : `${seats[opp].name} won the match`}
          </h2>
          <p className="text-sm/relaxed text-muted-foreground">
            <span className="font-mono font-semibold text-brass">{formatUsdc(table.stake * 2)} USDC</span>
            {iWon
              ? ` is waiting in escrow: your ${formatUsdc(table.stake)} USDC stake back plus your opponent’s ${formatUsdc(table.stake)}. Collect it to pay out.`
              : ` goes to ${seats[opp].name}. Either of you can send the payout.`}
          </p>
        </div>
        <Button size="xl" className="w-full shrink-0 md:w-auto md:min-w-52" onClick={onCollect} disabled={!!busy}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy ?? (iWon ? "Collect winnings" : "Pay the winner")}
        </Button>
      </div>
    );
  } else if (pastDeadline) {
    below = (
      <Alert variant="quiet" className={DOCK_ALERT}>
        <HourglassIcon />
        <AlertTitle className="text-base">Play stopped at the two-hour mark</AlertTitle>
        <AlertDescription>
          {refundIn === 0 ? "Either player can now return both stakes." : `Either player can return both stakes in ${mmss(refundIn ?? 600)}.`}
        </AlertDescription>
        {refundIn === 0 && (
          <Button size="xl" className={DOCK_BUTTON} onClick={onRefund} disabled={!!busy}>
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
      <Alert variant="quiet" className={DOCK_ALERT}>
        <MonitorSmartphoneIcon />
        <AlertTitle className="text-base">This match is open in another tab</AlertTitle>
        <AlertDescription>
          {/* No turn controls here, so this banner says whose turn it is. */}
          {BETTING.has(game.phase) && (
            <span className="block font-semibold text-foreground">{game.toAct === me ? "Your turn" : `${seats[opp].name}’s turn`}</span>
          )}
          Your seat is being played from another tab or browser, so this one is watching. Taking it back here asks your wallet
          once, and the other tab stops.
        </AlertDescription>
        <Button size="xl" className={DOCK_BUTTON} onClick={onPlayHere} disabled={!!busy}>
          {busy && <Spinner data-icon="inline-start" />}
          {busy ?? "Play here instead"}
        </Button>
      </Alert>
    );
  } else if (BETTING.has(game.phase)) {
    below = <ActionBar game={game} me={me} opponentName={seats[opp].name} acting={acting} onAct={act} />;
  } else if (game.handNumber === 0 && !game.checkedIn[opp]) {
    below = (
      <Alert variant="quiet" role="status" className={DOCK_ALERT}>
        <HourglassIcon />
        <AlertTitle className="text-base">Waiting for {seats[opp].name} to open the table</AlertTitle>
        <AlertDescription className="md:col-span-2">
          The first hand starts when you’re both here. If they never arrive, either of you can return both stakes
          {refundIn ? ` in ${Math.ceil(refundIn / 60)} minutes` : " after the match deadline"}.
        </AlertDescription>
      </Alert>
    );
  } else {
    below = (
      <Alert variant="quiet" role="status" className={DOCK_ALERT}>
        <ShuffleIcon />
        <AlertTitle className="text-base">{game.handNumber === 0 ? "Dealing the first hand" : "Next hand in a moment"}</AlertTitle>
        <AlertDescription className="md:col-span-2">The button moves and the blinds go up every hand.</AlertDescription>
      </Alert>
    );
  }

  return (
    <MatchSidebar
      controls={below}
      game={game}
      me={me}
      names={[seats[0].name, seats[1].name]}
      stake={table.stake}
      keys={table.keys}
      results={results}
      lastResult={lastResult}
    >
      <Felt game={game} hand={hand} me={me} seats={seats} lastResult={lastResult} />
    </MatchSidebar>
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
    <div className="flex flex-col justify-center gap-2 rounded-2xl bg-card p-3 ring-1 ring-river/40 md:px-5" role="status">
      <h2 className="flex items-center gap-2 font-heading text-lg font-extrabold">
        <ShuffleIcon aria-hidden="true" className="size-5 shrink-0 text-river" />
        Shuffling hand {hand}
      </h2>
      <ol className="grid gap-x-4 gap-y-1 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.label} className={cn("flex items-center gap-2 text-sm", s.state === "later" && "text-muted-foreground")}>
            {s.state === "done" ? (
              <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-river" strokeWidth={2.6} />
            ) : s.state === "now" ? (
              <Spinner className="size-4 shrink-0 text-river" />
            ) : (
              <CircleDashedIcon aria-hidden="true" className="size-4 shrink-0" />
            )}
            {s.label}
          </li>
        ))}
      </ol>
      <p className="text-[13px]/snug text-muted-foreground">
        Nobody can predict the deck: it mixes both players’ secrets with MagicBlock’s verifiable randomness.
      </p>
    </div>
  );
}
