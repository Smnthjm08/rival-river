import { moves, type Seat } from "./actions";
import type { GameView, HandView } from "./state";
import { programErrorName } from "./tx";

/** A move nobody needs to click: the client sends it when it's due. */
export type AutoStep = "startHand" | "submitSecret" | "requestShuffle" | "claimTimeout";

/**
 * What this seat should send now, given the latest snapshot. Both players'
 * clients run this, so the same step is often sent twice; see BENIGN.
 * Fold/check/call/raise are never automatic, except through claim_timeout.
 */
export function dueSteps(game: GameView, hand: HandView | null, seat: 0 | 1, now = Date.now() / 1000): AutoStep[] {
  if (!game.permissionsReady || game.phase === "finished") return [];
  const late = now > game.deadline;
  switch (game.phase) {
    case "waiting":
      return ["startHand"];
    case "dealing":
      // The opponent's Hand is private, so whether they've sent their secret
      // is unknown: request anyway, and SecretsMissing means "not yet".
      if (!hand?.hasSecret) return ["submitSecret"];
      return late ? ["requestShuffle", "claimTimeout"] : ["requestShuffle"];
    default:
      return game.toAct !== seat && late ? ["claimTimeout"] : [];
  }
}

/**
 * Errors that only mean the step isn't needed (yet): the other client sent
 * it first, or the opponent hasn't caught up. The next snapshot moves on.
 */
const BENIGN: Record<AutoStep, string[]> = {
  startHand: ["HandInProgress"],
  submitSecret: ["SecretAlreadySubmitted"],
  requestShuffle: ["ShufflePending", "SecretsMissing", "NotDealing"],
  claimTimeout: ["NotTimedOut", "SecretsMissing"],
};

/** Sends due steps in order. Throws only on errors that aren't BENIGN. */
export async function runSteps(s: Seat, steps: AutoStep[]): Promise<void> {
  for (const step of steps) {
    try {
      await moves[step](s);
    } catch (e) {
      const name = programErrorName(e);
      if (!name || !BENIGN[step].includes(name)) throw e;
    }
  }
}
