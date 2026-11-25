import { CheckIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SeatAvatar, type Character } from "@/components/rr/seat-avatar";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { cn } from "@/lib/utils";

export type StepState = "done" | "now" | "later";

/** Kit "Review the stakes": both seats, the pot, and where the match is. */
export function StakesReview({
  seats,
  stake,
  opponentDeposited,
  steps,
}: {
  seats: [{ name: string; character: Character }, { name: string; character: Character }];
  stake: number;
  opponentDeposited: boolean;
  steps: { label: string; state: StepState }[];
}) {
  return (
    <Card size="lg" className="bg-felt">
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
          {seats.map((s, i) => {
            const deposited = i === 0 || opponentDeposited;
            const seat = (
              <div key={s.name + i} className="flex flex-col items-center gap-2.5 text-center">
                <SeatAvatar who={s.character} size={84} state={deposited ? "winner" : "idle"} />
                <span className="font-semibold">{s.name}</span>
                <span className="font-mono text-xl text-brass">{formatUsdc(stake)} USDC</span>
                {deposited ? (
                  <span className="flex items-center gap-1.5 text-[13px] text-river">
                    <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={2.6} />
                    Deposited
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">Waiting for deposit</span>
                )}
              </div>
            );
            return i === 0 ? (
              [seat, <span key="vs" className="font-heading text-[28px] font-extrabold text-muted-foreground">vs</span>]
            ) : (
              seat
            );
          })}
        </div>

        <div className="flex items-baseline justify-between rounded-2xl bg-ink px-5 py-4.5">
          <span className="text-[15px] text-muted-foreground">Winner takes</span>
          <span className="font-mono text-[30px] font-semibold text-brass">{formatUsdc(stake * 2)} USDC</span>
        </div>

        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center gap-3 text-[15px]">
              <span
                className={cn(
                  "flex size-6.5 shrink-0 items-center justify-center rounded-full",
                  s.state === "done" && "bg-river text-ink",
                  s.state === "now" && "border-2 border-brass",
                  s.state === "later" && "border-2 border-foreground/20",
                )}
              >
                {s.state === "done" && <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />}
              </span>
              <span className={s.state === "later" ? "text-muted-foreground" : undefined}>{s.label}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
