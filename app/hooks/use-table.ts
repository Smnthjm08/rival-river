"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  base,
  fetchGame,
  fetchTable,
  isOnRollup,
  programErrorName,
  type GameView,
  type TableView,
} from "@/lib/rival";

export interface TableState {
  /** undefined while loading; null once we know the table is closed (settled, cancelled or refunded and closed). */
  table: TableView | null | undefined;
  /** The game while it's on Solana (before delegation or after undelegation); null otherwise. */
  gameOnSolana: GameView | null;
  /** The router reports the game delegated to the rollup. */
  onRollup: boolean;
  /** The router put the game on a rollup other than the TEE: nothing is safe to send. */
  wrongRollup?: boolean;
}

/** Polls a table on Solana. Cheap enough at one read every few seconds. */
export function useTable(tablePda: PublicKey | null, everyMs = 3000) {
  const [state, setState] = useState<TableState>({
    table: undefined,
    gameOnSolana: null,
    onRollup: false,
  });

  const refresh = useCallback(async () => {
    if (!tablePda) return;
    const table = await fetchTable(base, tablePda).catch(() => undefined);
    if (table === undefined) return; // network hiccup: keep the last state
    if (!table || table.status !== "inPlay") {
      setState({ table, gameOnSolana: null, onRollup: false });
      return;
    }
    try {
      const gameOnSolana = await fetchGame(base, table.keys.game);
      const onRollup = !gameOnSolana && (await isOnRollup(table.keys));
      setState({ table, gameOnSolana, onRollup });
    } catch (e) {
      if (programErrorName(e) === "WrongRollup") {
        console.error("[rival]", e);
        setState({ table, gameOnSolana: null, onRollup: false, wrongRollup: true });
        return;
      }
      // A failed read says nothing about the game: keep what's on screen, so
      // one dropped request doesn't take a player off the table mid-hand.
      // Only the first look at a match in play has nothing to keep.
      console.warn("[rival] couldn't check where the game is", e);
      setState((s) => (s.table?.status === "inPlay" ? s : { table, gameOnSolana: null, onRollup: false }));
    }
  }, [tablePda]);

  useEffect(() => {
    if (!tablePda) return;
    let stop = false;
    const tick = async () => {
      await refresh();
      if (!stop) timer = setTimeout(tick, everyMs);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [tablePda, everyMs, refresh]);

  return { ...state, refresh };
}
