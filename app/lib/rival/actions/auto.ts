import { moves, type Seat } from "./rollup";
import type { Card } from "../game/cards";
import type { GameView, HandView } from "../game/state";
import { programErrorName } from "../chain/tx";

/** A move nobody needs to click: the client sends it when it's due. */
export type AutoStep =
  | "checkIn"
  | "startHand"
  | "submitSecret"
  | "requestShuffle"
  | "claimTimeout";

/**
 * What this seat should send now, given the latest snapshot. Both players'
 * clients run this, so the same step is often sent twice; see BENIGN.
 * Starts the next hand at once: a live table should use HandTracker.
 * Fold/check/call/raise are never automatic, except through claim_timeout.
 */
export function dueSteps(
  game: GameView,
  hand: HandView | null,
  seat: 0 | 1,
  now = Date.now() / 1000
): AutoStep[] {
  if (!game.permissionsReady || game.phase === "finished") return [];
  // Play stops at the match deadline: the program refuses with MatchExpired,
  // and on the rollup a refused transaction still runs and is recorded, so
  // sending them would spam the TEE every poll until the tab closed.
  if (now > game.matchDeadline) return [];
  if (!game.checkedIn[seat]) return ["checkIn"];
  const late = now > game.deadline;
  switch (game.phase) {
    case "waiting":
      // No hand until the other player has shown up too.
      return game.checkedIn[1 - seat] ? ["startHand"] : [];
    case "dealing":
      // The opponent's Hand is private, so whether they've sent their secret
      // is unknown: request anyway, and SecretsMissing means "not yet".
      if (!hand?.hasSecret) return ["submitSecret"];
      return late ? ["requestShuffle", "claimTimeout"] : ["requestShuffle"];
    default:
      return game.toAct !== seat && late ? ["claimTimeout"] : [];
  }
}

type Pair<T> = [T, T];

/** How a finished hand ended, kept after start_hand clears it on chain. */
export interface HandResult {
  handNumber: number;
  /** Face-up board: all five after a showdown, none after a fold. */
  board: Card[];
  /** Both hole cards if it went to showdown, null if someone folded. */
  shown: Pair<Pair<Card>> | null;
  stacks: Pair<number>;
  /** Chips each player won (+) or lost (-) this hand. Null if this tab joined mid-hand without seeing it start. */
  won: Pair<number> | null;
}

/**
 * dueSteps for a live table. Remembers each hand's result, and holds off the
 * next start_hand for `pauseSeconds` so players can see how the hand ended
 * (start_hand clears the shown cards and board on chain). One per tab and game.
 */
export class HandTracker {
  /** The most recent finished hand, for the UI to show. */
  lastResult: HandResult | null = null;
  private endedAt = 0;
  private handStart: { handNumber: number; stacks: Pair<number> } | null = null;
  /** Steps that just came back "not yet", and when they may be tried again. */
  private retryAt = new Map<AutoStep, number>();

  constructor(readonly seat: 0 | 1, readonly pauseSeconds = 4) {}

  /** Call with every new snapshot. Returns the steps to send now. */
  due(
    game: GameView,
    hand: HandView | null,
    now = Date.now() / 1000
  ): AutoStep[] {
    const between = game.phase === "waiting" || game.phase === "finished";
    if (!between) {
      // Heads-up, both players put the same into the pot, so a player's
      // stack at the start of the hand is what they hold + bet + half the pot.
      const start = game.stacks.map(
        (s, i) => s + game.bets[i] + game.pot / 2
      ) as Pair<number>;
      this.handStart = { handNumber: game.handNumber, stacks: start };
    } else if (
      game.handNumber > 0 &&
      this.lastResult?.handNumber !== game.handNumber
    ) {
      const start =
        this.handStart?.handNumber === game.handNumber
          ? this.handStart.stacks
          : null;
      this.lastResult = {
        handNumber: game.handNumber,
        board: game.board,
        shown: game.shown,
        stacks: game.stacks,
        won: start && (game.stacks.map((s, i) => s - start[i]) as Pair<number>),
      };
      this.endedAt = now;
    }
    if (game.phase === "waiting" && now - this.endedAt < this.pauseSeconds)
      return [];
    return dueSteps(game, hand, this.seat, now).filter(
      (step) => (this.retryAt.get(step) ?? 0) <= now
    );
  }

  /**
   * A step came back BENIGN ("not yet", e.g. SecretsMissing while the
   * opponent's secret is on its way). Hold it off for a moment: on the
   * rollup every refused transaction still runs and is recorded, so retrying
   * on every poll would fill the TEE with failures.
   */
  backOff(step: AutoStep, seconds = 2, now = Date.now() / 1000) {
    this.retryAt.set(step, now + seconds);
  }
}

/**
 * Errors that only mean the step isn't needed (yet): the other client sent
 * it first, or the opponent hasn't caught up. The next snapshot moves on.
 */
const BENIGN: Record<AutoStep, string[]> = {
  checkIn: [],
  startHand: ["HandInProgress"],
  submitSecret: ["SecretAlreadySubmitted"],
  requestShuffle: ["ShufflePending", "SecretsMissing", "NotDealing"],
  claimTimeout: ["NotTimedOut", "SecretsMissing"],
};

/**
 * Sends due steps in order. Throws only on errors that aren't BENIGN;
 * `onBenign` hears about those (HandTracker.backOff, to slow the retries).
 */
export async function runSteps(
  s: Seat,
  steps: AutoStep[],
  onBenign?: (step: AutoStep) => void
): Promise<void> {
  for (const step of steps) {
    try {
      await moves[step](s);
    } catch (e) {
      const name = programErrorName(e);
      if (!name || !BENIGN[step].includes(name)) throw e;
      onBenign?.(step);
    }
  }
}
