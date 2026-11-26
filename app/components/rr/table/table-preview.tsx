"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/rr/site-header";
import { ActionBar } from "@/components/rr/table/action-bar";
import { Felt, type SeatInfo } from "@/components/rr/table/felt";
import { MatchSidebar } from "@/components/rr/table/match-sidebar";
import { card, matchKeys, type GameView, type HandResult } from "@/lib/rival";

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

function sampleGame(toAct: 0 | 1): GameView {
  return {
    handNumber: 3,
    players: [keys.creator, keys.opponent],
    sessionKeys: [null, null],
    permissionsReady: true,
    // Always: stacks + bets + pot = 200.
    stacks: [85, 55],
    bets: [0, 20],
    pot: 40,
    dealer: 0,
    toAct,
    acted: [false, true],
    minRaise: 40,
    phase: "flop",
    board: [c("Kh"), c("7c"), c("Qd")],
    shown: null,
    deadline: Date.now() / 1000 + 18,
    matchDeadline: Date.now() / 1000 + 3600,
    winner: null,
  };
}

/** The live table with fixed sample data: hand 3, the flop, the Otter has bet 20. */
export function TablePreview() {
  const [toAct, setToAct] = useState<0 | 1>(0);
  const [game] = useState(() => sampleGame(0));
  const g = { ...game, toAct };
  return (
    <>
      <SiteHeader>
        {toAct === 0 ? (
          <Badge variant="brass" size="lg" className="font-semibold">Your turn</Badge>
        ) : (
          <Badge variant="river" size="lg" className="font-semibold">The Otter’s turn</Badge>
        )}
        <Badge variant="rail" size="lg" className="font-semibold">Hand 3 of 6</Badge>
        <Badge variant="rail" size="lg">Blinds <span className="font-mono font-semibold">20 / 40</span></Badge>
        <Badge variant="river" size="lg" className="font-semibold"><LockIcon />Private rollup</Badge>
      </SiteHeader>
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-8 sm:pb-10">
        <div className="flex flex-wrap gap-6">
          <section aria-label="Table" className="flex min-w-0 flex-[999_1_720px] flex-col gap-4.5">
            <Felt game={g} hand={{ cards: [c("Ks"), c("7h")], hasSecret: false }} me={0} seats={seats} lastResult={results[1]} />
            <ActionBar game={g} me={0} opponentName="The Otter" acting={false} onAct={async () => setToAct(1)} />
          </section>
          <MatchSidebar game={g} me={0} names={["You", "The Otter"]} stake={10_000_000} keys={keys} results={results} lastResult={results[1]} />
        </div>
      </main>
    </>
  );
}
