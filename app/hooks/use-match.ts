"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMatch,
  HandTracker,
  isTeeAuthError,
  moves,
  runSteps,
  type Action,
  type GameView,
  type HandResult,
  type HandView,
  type Seat,
} from "@/lib/rival";

export interface MatchState {
  game: GameView | null;
  hand: HandView | null;
  /** The most recent finished hand, kept after the next one starts. */
  lastResult: HandResult | null;
  /** Every finished hand this tab saw, by hand number. */
  results: HandResult[];
}

const resultsKey = (s: Seat) => `rr:results:${s.keys.game.toBase58()}`;

/**
 * Live match on the rollup for one seat: polls Game and your Hand, sends the
 * automatic steps (start hand, secret, shuffle, timeout claims) through the
 * session key, and exposes `act` for fold / check / call / raise. If the TEE
 * refuses the login token, polling stops and `onAuthLost` is called.
 */
export function useMatch(
  seat: Seat | null,
  onAuthLost?: () => void,
  everyMs = 800
) {
  const [state, setState] = useState<MatchState>({
    game: null,
    hand: null,
    lastResult: null,
    results: [],
  });
  const [acting, setActing] = useState(false);
  const tracker = useRef<HandTracker | null>(null);
  const running = useRef(false);
  const authLost = useRef(onAuthLost);
  useEffect(() => {
    authLost.current = onAuthLost;
  });

  useEffect(() => {
    if (!seat) return;
    tracker.current = new HandTracker(seat.seat);
    const saved = JSON.parse(
      sessionStorage.getItem(resultsKey(seat)) ?? "[]"
    ) as HandResult[];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring this tab's hand history once per seat
    setState((s) => ({ ...s, results: saved }));

    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { game, hand } = await fetchMatch(seat.tee, seat.keys, seat.seat);
        if (game && !stop) {
          const due = tracker.current!.due(game, hand);
          const r = tracker.current!.lastResult;
          setState((s) => {
            const results =
              r && !s.results.some((x) => x.handNumber === r.handNumber)
                ? [...s.results, r]
                : s.results;
            if (results !== s.results)
              sessionStorage.setItem(resultsKey(seat), JSON.stringify(results));
            return { game, hand, lastResult: r, results };
          });
          // One batch of automatic steps at a time; the next snapshot decides
          // again. None if another tab has taken over this seat (its session
          // key replaced ours): they'd only fail.
          if (due.length && !running.current && isOurs(game, seat)) {
            running.current = true;
            const tracker_ = tracker.current!;
            runSteps(seat, due, (step) => tracker_.backOff(step))
              .catch((e) => console.warn("[rival] automatic step failed", e))
              .finally(() => (running.current = false));
          }
        }
      } catch (e) {
        if (isTeeAuthError(e)) {
          stop = true;
          authLost.current?.();
          return;
        }
        console.warn("[rival] poll failed", e);
      }
      if (!stop) timer = setTimeout(tick, everyMs);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [seat, everyMs]);

  const act = useCallback(
    async (action: Action) => {
      if (!seat) return;
      setActing(true);
      try {
        await moves.act(seat, action);
      } finally {
        setActing(false);
      }
    },
    [seat]
  );

  // Another tab of the same wallet registered its own session key for this seat.
  const displaced = !!seat && !!state.game && !isOurs(state.game, seat);
  return { ...state, act, acting, displaced };
}

/** True while the game still lists this tab's session key for its seat. */
function isOurs(game: GameView, seat: Seat): boolean {
  return !!game.sessionKeys[seat.seat]?.equals(seat.session.publicKey);
}
