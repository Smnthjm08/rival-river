import { CheckIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { SeatAvatar, type Character } from "@/components/rr/seat-avatar";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { cn } from "@/lib/utils";

export type StepState = "done" | "now" | "later";

type Seat = { name: string; character: Character; address?: string };
const ROLES = ["Opened the table", "Invited"];

/** Kit "Review the stakes": both seats, the pot, and where the match is. */
export function StakesReview({
  seats,
  stake,
  opponentDeposited,
  steps,
}: {
  seats: [Seat, Seat];
  stake: number;
  opponentDeposited: boolean;
  steps: { label: string; state: StepState }[];
}) {
  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-card p-5 sm:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
        {seats.map((s, i) => {
          const deposited = i === 0 || opponentDeposited;
          const seat = (
            <div key={s.name + i} className="flex min-w-0 flex-col items-center gap-2 text-center">
              <SeatAvatar who={s.character} size={64} state={deposited ? "winner" : "idle"} />
              <span className="flex flex-col items-center">
                <span className="font-semibold">{s.name}</span>
                <span className="text-sm text-muted-foreground">{ROLES[i]}</span>
                {s.address && <span className="font-mono text-xs text-muted-foreground">{s.address}</span>}
              </span>
              <span className="font-mono text-lg text-brass">{formatUsdc(stake)} USDC</span>
              {deposited ? (
                <span className="flex items-center gap-1.5 text-sm text-river">
                  <CheckIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2.6} />
                  Deposited
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Waiting for deposit</span>
              )}
            </div>
          );
          return i === 0 ? (
            [seat, <span key="vs" className="mt-4 font-heading text-2xl font-extrabold text-muted-foreground">vs</span>]
          ) : (
            seat
          );
        })}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-y py-4">
        <span className="text-muted-foreground">Winner takes</span>
        <span className="font-mono text-3xl font-semibold text-brass">{formatUsdc(stake * 2)} USDC</span>
      </div>

      <ol className="flex flex-col gap-3">
        {steps.map((s) => {
          const Icon = s.state === "done" ? CheckIcon : s.state === "now" ? CircleDotIcon : CircleIcon;
          return (
            <li key={s.label} className="flex items-start gap-3 text-sm/relaxed" aria-current={s.state === "now" ? "step" : undefined}>
              <Icon
                aria-hidden="true"
                className={cn("mt-0.5 size-4.5 shrink-0", s.state === "later" ? "text-mist/60" : "text-river")}
                strokeWidth={s.state === "done" ? 2.6 : 2}
              />
              <span className={s.state === "later" ? "text-muted-foreground" : s.state === "now" ? "font-semibold" : undefined}>{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
