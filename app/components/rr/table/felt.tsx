import { LockIcon } from "lucide-react";
import { motion } from "motion/react";
import type { GameView, HandResult, HandView } from "@/lib/rival";
import { CARD_PRESETS, EmptyCardSlot } from "@/components/rr/playing-card";
import { SeatAvatar, type Character, type SeatState } from "@/components/rr/seat-avatar";
import { BetPill, DealerButton, PotPill } from "@/components/rr/table-pieces";
import { DealtCard, RevealedCard, ShufflingDeck } from "@/components/rr/table/animated-cards";
import { cn } from "@/lib/utils";

const BETTING = new Set(["preflop", "flop", "turn", "river"]);
const BOARD_SLOTS = ["First flop card", "Second flop card", "Third flop card", "Turn card", "River card"];

export interface SeatInfo {
  name: string;
  character: Character;
  /** Short wallet address, so players can tell who's who. */
  address?: string;
}

interface FeltProps {
  game: GameView;
  hand: HandView | null;
  me: 0 | 1;
  seats: [SeatInfo, SeatInfo];
  lastResult: HandResult | null;
}

function seatState(game: GameView, seat: 0 | 1, lastResult: HandResult | null): SeatState {
  if (game.winner === seat) return "winner";
  if (BETTING.has(game.phase)) return game.toAct === seat ? "turn" : "idle";
  if (game.phase === "waiting" && lastResult?.handNumber === game.handNumber && lastResult.won) {
    if (lastResult.won[seat] > 0) return "winner";
    if (!lastResult.shown && lastResult.won[seat] < 0) return "folded";
  }
  return "idle";
}

/**
 * One seat. A river ring marks whose turn it is; the words for that live in
 * the dock under the table, once.
 */
function SeatPlate({ info, stack, state, dealer }: { info: SeatInfo; stack: number; state: SeatState; dealer: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-full bg-ink/70 py-1 pr-3.5 pl-1.5 ring-2 ring-transparent transition-shadow md:gap-3 md:py-1.5 md:pr-4",
        state === "turn" && "ring-river",
      )}
    >
      <SeatAvatar who={info.character} size={52} state={state} className="max-md:size-10!" />
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold md:text-[15px]">{info.name}</span>
        <span className="flex items-baseline gap-2.5 text-[13px] whitespace-nowrap text-muted-foreground">
          <span>
            <span className="font-mono text-foreground tabular-nums">{stack}</span> chips
          </span>
          {info.address && <span className="font-mono text-xs">{info.address}</span>}
        </span>
      </div>
      {dealer && <DealerButton />}
    </div>
  );
}

/**
 * The table, kit layout: opponent on top, board and pot in the middle, you at
 * the bottom. An oval on wide screens, a rounded slab on narrow ones. It is a
 * size container, so the cards scale to the room it's given.
 */
export function Felt({ game, hand, me, seats, lastResult }: FeltProps) {
  const opp = (1 - me) as 0 | 1;
  const shown = game.shown;
  const pot = game.pot;
  const myCards = shown ? shown[me] : hand?.cards ?? null;
  const n = game.handNumber;
  // The opponent's cards are on the table while the hand is live, or shown.
  const oppHasCards = BETTING.has(game.phase) || !!shown;
  // Dealt like a real dealer: one each, then one each again, opponent first.
  const dealDelay = (round: number, mine: boolean) => round * 0.3 + (mine ? 0.15 : 0);

  return (
    <div className="relative flex max-h-184 min-h-0 w-full flex-1 flex-col rounded-4xl border-6 border-rail bg-felt p-2 shadow-felt md:border-12 md:py-3 lg:rounded-[50%] lg:px-20 lg:py-4">
      <div aria-hidden="true" className="pointer-events-none absolute inset-3 hidden rounded-[50%] border-2 border-river/15 lg:block" />

      <div className="relative [container-type:size] flex min-h-0 flex-1 flex-col items-center justify-between gap-1">
        {/* Opponent */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <div className={cn("flex h-[calc(var(--cw)*1.4)] min-w-[calc(var(--cw)*1.75)] justify-center", CARD_PRESETS.opp)}>
              {shown ? (
                <>
                  <div className="-rotate-6"><RevealedCard key={`shown-${n}-0`} card={shown[opp][0]} width="opp" /></div>
                  <div className="-ml-4 rotate-6"><RevealedCard key={`shown-${n}-1`} card={shown[opp][1]} width="opp" delay={0.12} /></div>
                </>
              ) : (
                oppHasCards && (
                  <>
                    <div className="-rotate-6"><DealtCard key={`opp-${n}-0`} card={null} width="opp" from={{ x: 40, y: 170 }} delay={dealDelay(0, false)} /></div>
                    <div className="-ml-4 rotate-6"><DealtCard key={`opp-${n}-1`} card={null} width="opp" from={{ x: 10, y: 170 }} delay={dealDelay(1, false)} /></div>
                  </>
                )
              )}
            </div>
            <SeatPlate info={seats[opp]} stack={game.stacks[opp]} state={seatState(game, opp, lastResult)} dealer={game.dealer === opp} />
          </div>
          {/* The bet's room is kept, so nothing jumps when chips go in. */}
          <div className="flex min-h-7 items-center">{game.bets[opp] > 0 && <BetPill amount={game.bets[opp]} />}</div>
        </div>

        {/* Board and pot; the deck while the hand is shuffled */}
        <div className="flex flex-col items-center gap-2 md:gap-3">
          <PotPill amount={pot + game.bets[0] + game.bets[1]} />
          {game.phase === "dealing" ? (
            <ShufflingDeck label={`Shuffling hand ${n}`} />
          ) : (
            <div className="flex gap-1.5 md:gap-2.5">
              {BOARD_SLOTS.map((label, i) =>
                game.board[i] ? (
                  // The flop turns over one card after another.
                  <RevealedCard key={`${n}-${i}`} card={game.board[i]} width="board" delay={i < 3 ? i * 0.12 : 0} />
                ) : (
                  <EmptyCardSlot key={label} label={`${label}, not dealt yet`} width="board" />
                ),
              )}
            </div>
          )}
        </div>

        {/* You */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex min-h-7 items-center">{game.bets[me] > 0 && <BetPill amount={game.bets[me]} />}</div>
          <div className="flex flex-col items-center gap-1.5 md:flex-row md:items-end md:justify-center md:gap-5">
            <SeatPlate info={seats[me]} stack={game.stacks[me]} state={seatState(game, me, lastResult)} dealer={game.dealer === me} />
            <div className="flex flex-col items-center gap-2 max-md:order-first">
              <div className="flex gap-2">
                {myCards ? (
                  <>
                    <div className="rotate-[-4deg]"><DealtCard key={`me-${n}-0`} card={myCards[0]} width="hand" from={{ x: 60, y: -210 }} delay={dealDelay(0, true)} /></div>
                    <div className="rotate-[4deg]"><DealtCard key={`me-${n}-1`} card={myCards[1]} width="hand" from={{ x: -40, y: -210 }} delay={dealDelay(1, true)} /></div>
                  </>
                ) : (
                  <>
                    <EmptyCardSlot width="hand" label="Your first card, not dealt yet" />
                    <EmptyCardSlot width="hand" label="Your second card, not dealt yet" />
                  </>
                )}
              </div>
              {myCards && !shown && (
                // Fades in once your cards have turned over.
                <motion.span
                  key={`private-${n}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1, duration: 0.3 }}
                  className="flex items-center gap-1.5 rounded-full border border-river bg-ink px-2.5 py-0.5 text-[13px] font-semibold text-river"
                >
                  <LockIcon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
                  Only you can see these
                </motion.span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
