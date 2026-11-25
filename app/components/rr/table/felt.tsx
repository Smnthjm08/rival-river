import { LockIcon } from "lucide-react";
import type { GameView, HandResult, HandView } from "@/lib/rival";
import { EmptyCardSlot, PlayingCard } from "@/components/rr/playing-card";
import { SeatAvatar, type Character, type SeatState } from "@/components/rr/seat-avatar";
import { BetPill, DealerButton, PotPill } from "@/components/rr/table-pieces";

const BETTING = new Set(["preflop", "flop", "turn", "river"]);
const BOARD_SLOTS = ["First flop card", "Second flop card", "Third flop card", "Turn card", "River card"];

export interface SeatInfo {
  name: string;
  character: Character;
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

function SeatPlate({ info, stack, state, dealer }: { info: SeatInfo; stack: number; state: SeatState; dealer: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-full bg-ink/70 py-2 pr-4 pl-2">
      <SeatAvatar who={info.character} size={52} state={state} />
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{info.name}</span>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">{stack} chips</span>
      </div>
      {dealer && <DealerButton />}
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

  return (
    <div className="relative flex w-full flex-col items-center justify-between gap-6 rounded-[2.5rem] border-[12px] border-rail bg-felt px-4 py-8 shadow-[inset_0_0_0_2px_rgb(63_182_168/0.16),0_30px_60px_rgb(0_0_0/0.35)] md:aspect-[16/10] md:rounded-[50%] md:border-[16px] md:px-20 md:py-10">
      <div aria-hidden="true" className="pointer-events-none absolute inset-4 hidden rounded-[50%] border-2 border-river/15 md:block" />

      {/* Opponent */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <div className="flex">
            {shown ? (
              <>
                <div className="-rotate-6"><PlayingCard card={shown[opp][0]} width={58} /></div>
                <div className="-ml-5 rotate-6"><PlayingCard card={shown[opp][1]} width={58} /></div>
              </>
            ) : (
              <>
                <div className="-rotate-6"><PlayingCard faceDown width={58} /></div>
                <div className="-ml-5 rotate-6"><PlayingCard faceDown width={58} /></div>
              </>
            )}
          </div>
          <SeatPlate info={seats[opp]} stack={game.stacks[opp]} state={seatState(game, opp, lastResult)} dealer={game.dealer === opp} />
        </div>
        {game.bets[opp] > 0 && <BetPill amount={game.bets[opp]} />}
      </div>

      {/* Board and pot */}
      <div className="flex flex-col items-center gap-3.5">
        <PotPill amount={pot + game.bets[0] + game.bets[1]} />
        <div className="flex gap-1.5 sm:gap-2.5">
          {BOARD_SLOTS.map((label, i) =>
            game.board[i] ? (
              <PlayingCard key={label} card={game.board[i]} width="board" />
            ) : (
              <EmptyCardSlot key={label} label={`${label}, not dealt yet`} width="board" />
            ),
          )}
        </div>
      </div>

      {/* You */}
      <div className="flex flex-col items-center gap-3">
        {game.bets[me] > 0 && <BetPill amount={game.bets[me]} />}
        <div className="flex flex-wrap items-end justify-center gap-5">
          <SeatPlate info={seats[me]} stack={game.stacks[me]} state={seatState(game, me, lastResult)} dealer={game.dealer === me} />
          <div className="flex flex-col items-center gap-2.5">
            <div className="flex gap-2">
              {myCards ? (
                <>
                  <div className="-rotate-[4deg]"><PlayingCard card={myCards[0]} width="hand" /></div>
                  <div className="rotate-[4deg]"><PlayingCard card={myCards[1]} width="hand" /></div>
                </>
              ) : (
                <>
                  <EmptyCardSlot width="hand" label="Your first card, not dealt yet" />
                  <EmptyCardSlot width="hand" label="Your second card, not dealt yet" />
                </>
              )}
            </div>
            {myCards && !shown && (
              <span className="flex items-center gap-1.5 rounded-full border border-river bg-ink px-2.5 py-1 text-[13px] font-semibold text-river">
                <LockIcon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
                Only you can see these
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
