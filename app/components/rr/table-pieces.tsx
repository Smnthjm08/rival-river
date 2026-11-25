"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Kit chip in River: used beside bets. */
export function ChipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 60" aria-hidden="true" className={cn("size-4.5", className)}>
      <circle cx="30" cy="30" r="28" fill="var(--chip-river)" />
      <circle cx="30" cy="30" r="24" fill="none" stroke="var(--bone)" strokeWidth="6" strokeDasharray="9.4 9.4" />
    </svg>
  );
}

/** Centre-of-table pot: the one big brass number. */
export function PotPill({ amount }: { amount: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-brass/50 bg-ink px-4.5 py-2">
      <span className="text-xs font-semibold tracking-[0.12em] text-mist uppercase">Pot</span>
      <span className="font-mono text-xl font-semibold text-brass tabular-nums">{amount}</span>
    </div>
  );
}

/** A player's bet on the current street. */
export function BetPill({ amount }: { amount: number }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-ink/60 px-3.5 py-1.5 font-mono text-sm tabular-nums">
      <ChipIcon />
      Bet {amount}
    </div>
  );
}

export function DealerButton() {
  return (
    <span
      role="img"
      aria-label="Dealer button"
      className="flex size-7 items-center justify-center rounded-full bg-bone font-heading text-[15px] font-extrabold text-ink"
    >
      D
    </span>
  );
}

/**
 * Seconds until `deadline` (unix seconds), ticking. Null when there's no
 * deadline, or before the first tick: the clock is only read after mount, so
 * prerendering (Cache Components) never bakes in a stale time.
 */
export function useSecondsLeft(deadline: number | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) return;
    const tick = () => setNow(Date.now() / 1000);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [deadline]);
  return deadline === null || now === null ? null : Math.max(0, Math.ceil(deadline - now));
}

/**
 * Kit turn timer: a ring in river while there's time, brass in the last 5 s.
 * `total` is the full turn length, so the ring shows the share left.
 */
export function TurnTimer({ secondsLeft, total = 30, className }: { secondsLeft: number; total?: number; className?: string }) {
  const circumference = 94.2;
  const filled = Math.max(0, Math.min(1, secondsLeft / total)) * circumference;
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" className={cn("size-9", className)}>
      <circle cx="18" cy="18" r="15" fill="none" stroke="rgb(232 236 234 / 0.14)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke={secondsLeft <= 5 ? "var(--brass)" : "var(--river)"}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 18 18)"
        className="transition-[stroke-dasharray] duration-300 ease-linear"
      />
    </svg>
  );
}

/** Uppercase section label used across the kit's panels. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-xs font-semibold tracking-[0.14em] text-mist uppercase", className)}>{children}</span>;
}
