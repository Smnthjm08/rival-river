"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { TurnTimer, useSecondsLeft } from "@/components/rr/table-pieces";
import { friendlyError } from "@/lib/errors";
import { TURN_SECONDS, type Action, type GameView } from "@/lib/rival";

interface ActionBarProps {
  game: GameView;
  me: 0 | 1;
  opponentName: string;
  acting: boolean;
  onAct: (a: Action) => Promise<void>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Bottom bar of the table. On your turn: Fold, Check/Call, and a raise
 * slider with ½ pot / Pot / All-in. Otherwise: whose turn it is and their clock.
 */
export function ActionBar({ game, me, opponentName, acting, onAct }: ActionBarProps) {
  // Before the clock's first tick, assume a full turn rather than "out of time".
  const secondsLeft = useSecondsLeft(game.deadline) ?? TURN_SECONDS;
  const myTurn = game.toAct === me;
  const opp = 1 - me;

  const toCall = Math.max(0, game.bets[opp] - game.bets[me]);
  const maxTo = game.bets[me] + game.stacks[me];
  const opponentAllIn = game.stacks[opp] === 0;
  const canRaise = !opponentAllIn && maxTo > game.bets[opp];
  // A raise must be at least the last raise (or the big blind), unless it's all-in.
  const minTo = Math.min(game.bets[opp] + game.minRaise, maxTo);
  const potAfterCall = game.pot + game.bets[0] + game.bets[1] + toCall;

  const [chosen, setChosen] = useState<number | null>(null);
  const raiseTo = clamp(chosen ?? minTo, minTo, maxTo);

  async function act(a: Action) {
    try {
      await onAct(a);
      setChosen(null);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  if (!myTurn) {
    return (
      <div className="flex items-center gap-3 rounded-[1.25rem] bg-card p-4" role="status">
        <TurnTimer secondsLeft={secondsLeft} total={TURN_SECONDS} />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold">{opponentName}’s turn</span>
          <span className="text-[13px] text-muted-foreground">
            {secondsLeft > 0 ? `${secondsLeft} s left` : "Out of time: claiming the timeout for you…"}
          </span>
        </div>
      </div>
    );
  }

  const callLabel = toCall === 0 ? "Check" : toCall >= game.stacks[me] ? `All-in ${game.stacks[me]}` : `Call ${toCall}`;
  const raiseVerb = game.bets[opp] === 0 ? "Bet" : "Raise to";
  const raiseLabel = raiseTo === maxTo ? `All-in ${maxTo}` : `${raiseVerb} ${raiseTo}`;
  const presets = [
    { label: "½ pot", to: game.bets[opp] + Math.ceil(potAfterCall / 2) },
    { label: "Pot", to: game.bets[opp] + potAfterCall },
    { label: "All-in", to: maxTo },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[1.25rem] bg-card p-4">
      <div className="mr-2 flex items-center gap-2.5">
        <TurnTimer secondsLeft={secondsLeft} total={TURN_SECONDS} />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold">Your turn</span>
          <span className="text-[13px] text-muted-foreground">{secondsLeft} s left</span>
        </div>
      </div>

      <Button variant="fold" size="xl" disabled={acting} onClick={() => act({ fold: {} })}>
        Fold
      </Button>
      <Button variant="secondary" size="xl" disabled={acting} onClick={() => act(toCall === 0 ? { check: {} } : { call: {} })}>
        {callLabel}
      </Button>

      {canRaise && (
        <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-2.5">
          {maxTo > minTo && (
            <Slider
              aria-label="Raise amount"
              min={minTo}
              max={maxTo}
              step={1}
              value={[raiseTo]}
              onValueChange={(v) => setChosen(Array.isArray(v) ? v[0] : v)}
              className="min-w-30 flex-[1_1_140px]"
            />
          )}
          {maxTo > minTo &&
            presets.map((p) => (
              <Button key={p.label} variant="outline" size="lg" disabled={acting} onClick={() => setChosen(clamp(p.to, minTo, maxTo))}>
                {p.label}
              </Button>
            ))}
          <Button size="xl" disabled={acting} onClick={() => act({ raise: { to: raiseTo } })}>
            {acting && <Spinner data-icon="inline-start" />}
            <span className="font-sans">{raiseLabel.replace(/\d+$/, "")}</span>
            <span className="font-mono">{raiseTo}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
