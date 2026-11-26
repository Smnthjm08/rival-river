"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/rr/site-header";
import { MatchStatus, PrivateStatus } from "@/components/rr/table-pieces";
import { ActionBar } from "@/components/rr/table/action-bar";
import { Felt, type SeatInfo } from "@/components/rr/table/felt";
import { MatchSidebar } from "@/components/rr/table/match-sidebar";
import { ShuffleSteps } from "@/components/rr/table/live-table";
import { card, matchKeys, type GameView, type HandResult, type Phase } from "@/lib/rival";

// Card ids: rank + 13 × suit (suits c d h s; ranks 2..A = 0..12).
const id = (rank: string, suit: string) => "23456789TJQKA".indexOf(rank) + 13 * "cdhs".indexOf(suit);
const c = (s: string) => card(id(s[0], s[1]));

const keys = matchKeys(new PublicKey("963u7LYi6ojoCDht8eUdurft6hSHjWzRwNb3po8CZUZj"), new PublicKey("7DtDjtnmGy7EigcqWjXkr86or1BddwSu38CqvT64MA1K"), new BN(1));
const seats: [SeatInfo, SeatInfo] = [
  { name: "You", character: "heron", address: "963u…ZUZj" },
  { name: "The Otter", character: "otter", address: "7DtD…MA1K" },
];
const results: HandResult[] = [
  { handNumber: 1, board: [], shown: null, stacks: [105, 95], won: [5, -5] },
  { handNumber: 2, board: [c("Ah"), c("Jd"), c("2c"), c("9h"), c("2s")], shown: [[c("5h"), c("4c")], [c("6d"), c("Qc")]], stacks: [85, 115], won: [-20, 20] },
];
const BOARD = [c("Kh"), c("7c"), c("Qd"), c("2s"), c("9h")];
const STAKE = 10_000_000;

/** The stages the preview can replay, in order. */
const STAGES = ["dealing", "preflop", "flop", "turn", "river"] as const satisfies readonly Phase[];
type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, string> = { dealing: "Shuffle", preflop: "Deal", flop: "Flop", turn: "Turn", river: "River" };
const FACE_UP: Record<Stage, number> = { dealing: 0, preflop: 0, flop: 3, turn: 4, river: 5 };

function sampleGame(stage: Stage, toAct: 0 | 1, now: number): GameView {
  const early = stage === "dealing" || stage === "preflop";
  return {
    handNumber: 3,
    players: [keys.creator, keys.opponent],
    sessionKeys: [null, null],
    permissionsReady: true,
    checkedIn: [true, true],
    // Always: stacks + bets + pot = 200.
    stacks: early ? [65, 75] : [85, 55],
    bets: early ? [20, 40] : [0, 20],
    pot: early ? 0 : 40,
    dealer: 0,
    toAct,
    acted: [false, true],
    minRaise: 40,
    phase: stage,
    board: BOARD.slice(0, FACE_UP[stage]),
    shown: null,
    deadline: now + 18,
    matchDeadline: now + 3600,
    winner: null,
  };
}

/** The live table with fixed sample data, and buttons to replay each stage of a hand. */
export function TablePreview() {
  const [stage, setStage] = useState<Stage>("flop");
  const [toAct, setToAct] = useState<0 | 1>(0);
  // Bumped on every replay so the felt remounts and its animations run again.
  const [run, setRun] = useState(0);
  // Read the clock once (and again per replay), not on every render.
  const [now, setNow] = useState(() => Date.now() / 1000);
  const g = sampleGame(stage, toAct, now);
  const dealing = stage === "dealing";

  // `at`: the click's wall-clock time, so the turn clock restarts full.
  const play = (s: Stage, at: number) => {
    setStage(s);
    setToAct(0);
    setNow(at);
    // Moving forward (deal → flop → turn) keeps the table, like a real hand:
    // only the new cards animate. Going back or repeating replays from scratch.
    if (STAGES.indexOf(s) <= STAGES.indexOf(stage) || s === "preflop") setRun((r) => r + 1);
  };

  return (
    <>
      <SiteHeader quiet>
        <MatchStatus stake={STAKE} handNumber={3} />
        <PrivateStatus />
      </SiteHeader>
      <main className="mx-auto w-full max-w-360 px-2 sm:px-4">
        <MatchSidebar
          game={g}
          me={0}
          names={["You", "The Otter"]}
          stake={STAKE}
          keys={keys}
          results={results}
          lastResult={results[1]}
          controls={dealing ? <ShuffleSteps hand={3} secretIn /> : <ActionBar game={g} me={0} opponentName="The Otter" acting={false} onAct={async () => setToAct(1)} />}
          toolbar={
            <div role="group" aria-label="Preview replay" className="flex flex-wrap items-center justify-center gap-1.5">
              <span aria-hidden="true" className="mr-2 text-sm text-muted-foreground max-sm:hidden">Preview replay</span>
              {STAGES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === stage ? "secondary" : "outline"}
                  aria-pressed={s === stage}
                  className="max-sm:flex-1 max-sm:px-1"
                  onClick={(e) => play(s, (performance.timeOrigin + e.timeStamp) / 1000)}
                >
                  {STAGE_LABEL[s]}
                </Button>
              ))}
            </div>
          }
        >
          <Felt
            key={run}
            game={g}
            hand={{ cards: dealing ? null : [c("Ks"), c("7h")], hasSecret: dealing }}
            me={0}
            seats={seats}
            lastResult={results[1]}
          />
        </MatchSidebar>
      </main>
    </>
  );
}
