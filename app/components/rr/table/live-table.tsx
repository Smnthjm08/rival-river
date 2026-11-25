"use client";

import { useEffect } from "react";
import { HourglassIcon, ShuffleIcon, TrophyIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar } from "@/components/rr/table/action-bar";
import { Felt, type SeatInfo } from "@/components/rr/table/felt";
import { MatchSidebar } from "@/components/rr/table/match-sidebar";
import { useSecondsLeft } from "@/components/rr/table-pieces";
import { useMatch } from "@/hooks/use-match";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { refundOpensAt, type GameView, type Seat, type TableView } from "@/lib/rival";

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
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The table while the game is on the rollup: felt, actions, and the side panel. */
export function LiveTable({ seat, table, seats, busy, onCollect, onRefund, onGame }: LiveTableProps) {
  const { game, hand, lastResult, results, act, acting } = useMatch(seat);
  const me = seat.seat;
  const opp = (1 - me) as 0 | 1;
  const pastDeadline = useSecondsLeft(game?.matchDeadline ?? null) === 0;
  const refundIn = useSecondsLeft(refundOpensAt(table));

  useEffect(() => {
    if (game) onGame(game);
  }, [game, onGame]);

  if (!game) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="aspect-[16/10] w-full rounded-[2.5rem] md:rounded-[50%]" />
        <Skeleton className="h-20 w-full rounded-[1.25rem]" />
      </div>
    );
  }

  let below: React.ReactNode;
  if (game.phase === "finished") {
    const iWon = game.winner === me;
    below = (
      <Card size="lg" className="border border-brass/45" role="dialog" aria-labelledby="match-over">
        <CardHeader>
          <CardTitle id="match-over" className="flex items-center gap-3 font-heading text-4xl font-extrabold tracking-tight">
            {iWon && <TrophyIcon aria-hidden="true" className="size-8 text-brass" />}
            {iWon ? "You won the match" : `${seats[opp].name} won the match`}
          </CardTitle>
          <CardDescription className="text-base/relaxed">
            <span className="font-mono font-semibold text-brass">{formatUsdc(table.stake * 2)} USDC</span>
            {iWon
              ? " is waiting in escrow. Collect it to bring the game back to Solana and pay out."
              : ` goes to ${seats[opp].name}. Either of you can send the payout.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="xl" onClick={onCollect} disabled={!!busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ?? (iWon ? "Collect winnings" : "Pay the winner")}
          </Button>
        </CardContent>
      </Card>
    );
  } else if (pastDeadline) {
    below = (
      <Alert variant="quiet">
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
    below = (
      <Alert variant="live" role="status">
        <ShuffleIcon />
        <AlertTitle className="text-base">{hand?.hasSecret ? "Shuffling the deck" : "Sealing your secret"}</AlertTitle>
        <AlertDescription className="text-sm">
          {hand?.hasSecret
            ? "Waiting for both secrets and the VRF oracle. Usually under a second."
            : "Your browser adds a random secret to the shuffle, so nobody, not even the oracle, can know the deck."}
        </AlertDescription>
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
    <div className="flex flex-wrap gap-6">
      <section aria-label="Table" className="flex min-w-0 flex-[999_1_720px] flex-col gap-4.5">
        <Felt game={game} hand={hand} me={me} seats={seats} lastResult={lastResult} />
        {below}
      </section>
      <MatchSidebar
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
