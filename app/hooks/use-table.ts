"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { base, fetchGame, fetchTable, isOnRollup, type GameView, type TableView } from "@/lib/rival";

export interface TableState {
  /** undefined while loading; null once we know the table is closed (settled, cancelled or refunded and closed). */
  table: TableView | null | undefined;
  /** The game while it's on Solana (before delegation or after undelegation); null otherwise. */
  gameOnSolana: GameView | null;
  /** The router reports the game delegated to the rollup. */
  onRollup: boolean;
}

/** Polls a table on Solana. Cheap enough at one read every few seconds. */
export function useTable(tablePda: PublicKey | null, everyMs = 3000) {
  const [state, setState] = useState<TableState>({ table: undefined, gameOnSolana: null, onRollup: false });

  const refresh = useCallback(async () => {
    if (!tablePda) return;
    const table = await fetchTable(base, tablePda).catch(() => undefined);
    if (table === undefined) return; // network hiccup: keep the last state
    if (!table || table.status !== "inPlay") {
      setState({ table, gameOnSolana: null, onRollup: false });
      return;
    }
    const gameOnSolana = await fetchGame(base, table.keys.game).catch(() => null);
    const onRollup = gameOnSolana ? false : await isOnRollup(table.keys).catch(() => false);
    setState({ table, gameOnSolana, onRollup });
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
