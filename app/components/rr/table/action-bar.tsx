"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { TurnTimer, useSecondsLeft } from "@/components/rr/table-pieces";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { TURN_SECONDS, type Action, type GameView } from "@/lib/rival";

interface ActionBarProps {
  game: GameView;
  me: 0 | 1;
  opponentName: string;
  acting: boolean;
  onAct: (a: Action) => Promise<void>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** On phones the bar is pinned to the bottom of the screen, so acting never needs a scroll. */
export const PINNED_ON_PHONES = "max-md:fixed max-md:w-auto max-md:inset-x-2 max-md:bottom-2 max-md:z-30 max-md:shadow-[0_-12px_40px_rgb(0_0_0/0.55)]";

/**
 * Turn controls, at the top of the right-hand column. On your turn: Fold,
 * Check/Call, and a raise slider with ½ pot / Pot / All-in. Otherwise: whose
 * turn it is and their clock.
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
  // Phones only: the slider and presets open above the bar on demand.
  const [raiseOpen, setRaiseOpen] = useState(false);

  async function act(a: Action) {
    try {
      await onAct(a);
      setChosen(null);
      setRaiseOpen(false);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  if (!myTurn) {
    return (
      <div className={cn("flex items-center gap-3 rounded-[1.25rem] bg-card p-4", PINNED_ON_PHONES)} role="status">
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
    <div className={cn("flex flex-col gap-3.5 rounded-[1.25rem] bg-card p-4 ring-2 ring-brass/70 max-md:gap-2.5 max-md:p-3", PINNED_ON_PHONES)}>
      <div className="flex items-center gap-2.5">
        <TurnTimer secondsLeft={secondsLeft} total={TURN_SECONDS} />
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold text-brass">Your turn</span>
          <span className="text-[13px] text-muted-foreground">{secondsLeft} s left · amounts in chips</span>
        </div>
      </div>

      <div className={cn("grid grid-cols-2 gap-2", canRaise && !raiseOpen && "max-md:grid-cols-3")}>
        <Button variant="fold" size="xl" disabled={acting} onClick={() => act({ fold: {} })}>
          Fold
        </Button>
        <Button variant="secondary" size="xl" disabled={acting} onClick={() => act(toCall === 0 ? { check: {} } : { call: {} })}>
          {callLabel}
        </Button>
        {canRaise && !raiseOpen && (
          <Button size="xl" className="md:hidden" disabled={acting} onClick={() => setRaiseOpen(true)}>
            {raiseVerb === "Bet" ? "Bet…" : "Raise…"}
          </Button>
        )}
      </div>

      {canRaise && (
        <div className={cn("flex flex-col gap-2.5", !raiseOpen && "max-md:hidden")}>
          {maxTo > minTo && (
            <>
              <Slider
                aria-label="Raise amount"
                min={minTo}
                max={maxTo}
                step={1}
                value={[raiseTo]}
                onValueChange={(v) => setChosen(Array.isArray(v) ? v[0] : v)}
                className="py-2"
              />
              <div className="grid grid-cols-3 gap-2">
                {presets.map((p) => (
                  <Button key={p.label} variant="outline" size="lg" disabled={acting} onClick={() => setChosen(clamp(p.to, minTo, maxTo))}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </>
          )}
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
