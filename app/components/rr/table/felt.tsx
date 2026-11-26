import { LockIcon } from "lucide-react";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import type { GameView, HandResult, HandView } from "@/lib/rival";
import { EmptyCardSlot } from "@/components/rr/playing-card";
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

function SeatPlate({ info, stack, state, dealer, mine }: { info: SeatInfo; stack: number; state: SeatState; dealer: boolean; mine: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={cn(
          "flex items-center gap-3 rounded-full bg-ink/70 py-2 pr-4 pl-2 ring-2 ring-transparent transition-shadow",
          state === "turn" && (mine ? "ring-brass" : "ring-river"),
        )}
      >
        <SeatAvatar who={info.character} size={52} state={state} />
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">
            {info.name}
            {info.address && <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{info.address}</span>}
          </span>
          <span className="font-mono text-sm text-muted-foreground tabular-nums">{stack} chips</span>
        </div>
        {dealer && <DealerButton />}
      </div>
      {state === "turn" &&
        (mine ? (
          <Badge variant="brass" size="lg" className="font-semibold">Your turn</Badge>
        ) : (
          <Badge variant="river" size="lg" className="font-semibold">{info.name} is thinking…</Badge>
        ))}
    </div>
  );
}

/**
 * The table, kit layout: opponent on top, board and pot in the middle, you at
 * the bottom. An oval on wide screens, a rounded slab on phones.
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
    <div className="relative flex w-full flex-col items-center justify-between gap-3.5 rounded-[2rem] border-8 border-rail bg-felt px-3 py-4 md:gap-6 shadow-[inset_0_0_0_2px_rgb(63_182_168/0.16),0_30px_60px_rgb(0_0_0/0.35)] md:aspect-16/10 md:rounded-[50%] md:border-16 md:px-20 md:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-4 hidden rounded-[50%] border-2 border-river/15 md:block" />

      {/* Opponent */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <div className="flex h-20.25 min-w-24">
            {shown ? (
              <>
                <div className="-rotate-6"><RevealedCard key={`shown-${n}-0`} card={shown[opp][0]} width={58} /></div>
                <div className="-ml-5 rotate-6"><RevealedCard key={`shown-${n}-1`} card={shown[opp][1]} width={58} delay={0.12} /></div>
              </>
            ) : (
              oppHasCards && (
                <>
                  <div className="-rotate-6"><DealtCard key={`opp-${n}-0`} card={null} width={58} from={{ x: 40, y: 170 }} delay={dealDelay(0, false)} /></div>
                  <div className="-ml-5 rotate-6"><DealtCard key={`opp-${n}-1`} card={null} width={58} from={{ x: 10, y: 170 }} delay={dealDelay(1, false)} /></div>
                </>
              )
            )}
          </div>
          <SeatPlate info={seats[opp]} stack={game.stacks[opp]} state={seatState(game, opp, lastResult)} dealer={game.dealer === opp} mine={false} />
        </div>
        {game.bets[opp] > 0 && <BetPill amount={game.bets[opp]} />}
      </div>

      {/* Board and pot; the deck while the hand is shuffled */}
      <div className="flex flex-col items-center gap-3.5">
        <PotPill amount={pot + game.bets[0] + game.bets[1]} />
        {game.phase === "dealing" ? (
          <ShufflingDeck label={`Shuffling hand ${n}`} />
        ) : (
          <div className="flex gap-1.5 sm:gap-2.5">
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
      <div className="flex flex-col items-center gap-3">
        {game.bets[me] > 0 && <BetPill amount={game.bets[me]} />}
        <div className="flex flex-wrap items-end justify-center gap-3.5 md:gap-5">
          <SeatPlate info={seats[me]} stack={game.stacks[me]} state={seatState(game, me, lastResult)} dealer={game.dealer === me} mine />
          <div className="flex flex-col items-center gap-2.5 max-md:order-first">
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
                className="flex items-center gap-1.5 rounded-full border border-river bg-ink px-2.5 py-1 text-[13px] font-semibold text-river"
              >
                <LockIcon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
                Only you can see these
              </motion.span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
