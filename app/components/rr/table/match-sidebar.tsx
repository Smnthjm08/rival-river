import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Eyebrow } from "@/components/rr/table-pieces";
import { PlayingCard } from "@/components/rr/playing-card";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { STARTING_STACK, MAX_HANDS, type GameView, type HandResult, type MatchKeys } from "@/lib/rival";
import { cn } from "@/lib/utils";

export const explorer = (kind: "address" | "tx", id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

interface MatchSidebarProps {
  game: GameView;
  me: 0 | 1;
  names: [string, string];
  stake: number;
  keys: MatchKeys;
  results: HandResult[];
  lastResult: HandResult | null;
}

/** Right-hand column: what's at stake, how the match is going, and why the deck is fair. */
export function MatchSidebar({ game, me, names, stake, keys, results, lastResult }: MatchSidebarProps) {
  const opp = (1 - me) as 0 | 1;
  const byHand = new Map(results.map((r) => [r.handNumber, r]));
  const hands = Array.from({ length: MAX_HANDS }, (_, i) => i + 1);

  return (
    <aside aria-label="Match details" className="flex max-w-full min-w-0 flex-[1_1_300px] flex-col gap-4">
      <Card size="lg" className="rounded-[1.25rem]">
        <CardContent className="flex flex-col gap-1.5">
          <Eyebrow>Winner takes</Eyebrow>
          <span className="font-mono text-[34px] font-semibold text-brass">{formatUsdc(stake * 2)} USDC</span>
          <span className="text-sm/relaxed text-muted-foreground">
            {formatUsdc(stake)} USDC each, held in escrow on Solana. Bets are in chips, not USDC: win all{" "}
            {STARTING_STACK * 2} chips, or lead after {MAX_HANDS} hands, and you take the whole {formatUsdc(stake * 2)} USDC.
          </span>
          <a href={explorer("address", keys.vault.toBase58())} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 text-sm text-brass underline-offset-4 hover:underline">
            View escrow account
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
        </CardContent>
      </Card>

      <Card size="lg" className="rounded-[1.25rem]">
        <CardContent className="flex flex-col gap-3.5">
          <Eyebrow>{game.handNumber > MAX_HANDS ? `Sudden death · hand ${game.handNumber}` : "Match"}</Eyebrow>
          <div className="grid grid-cols-6 gap-1.5">
            {hands.map((n) => {
              const r = byHand.get(n);
              const now = n === game.handNumber && game.phase !== "waiting" && game.phase !== "finished";
              const won = r?.won ? r.won[me] > 0 : null;
              const label = now ? "Now" : r ? (r.won ? (r.won[me] > 0 ? "Won" : r.won[me] < 0 ? "Lost" : "Split") : "Done") : String(n);
              return (
                <div key={n} className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "h-2 w-full rounded-full",
                      now ? "bg-river" : won === true ? "bg-brass" : r ? "bg-[#5e6e6b]" : "bg-foreground/12",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between gap-2 font-mono text-sm tabular-nums">
            <span>{names[me]} {game.stacks[me]}</span>
            <span className="text-muted-foreground">Pot {game.pot + game.bets[0] + game.bets[1]}</span>
            <span>{names[opp]} {game.stacks[opp]}</span>
          </div>
        </CardContent>
      </Card>

      {lastResult?.won && (
        <Card size="lg" className="rounded-[1.25rem] bg-felt">
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>Hand {lastResult.handNumber}</Eyebrow>
              <span className={cn("font-mono text-lg font-semibold", lastResult.won[me] > 0 ? "text-brass" : "text-muted-foreground")}>
                {lastResult.won[me] > 0 ? "+" : ""}
                {lastResult.won[me]}
              </span>
            </div>
            <span className="text-[15px]">
              {lastResult.won[me] > 0 ? "You won the hand" : lastResult.won[me] < 0 ? `${names[opp]} won the hand` : "Split pot"}
              {lastResult.shown ? " at showdown." : `: ${lastResult.won[me] > 0 ? names[opp] : "you"} folded, cards stay sealed.`}
            </span>
            {lastResult.shown && (
              <div className="flex flex-wrap gap-1.5">
                {[...lastResult.shown[me], ...lastResult.board].map((c) => (
                  <PlayingCard key={c.id} card={c} width={40} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card size="lg" className="rounded-[1.25rem]">
        <CardContent className="flex flex-col gap-3">
          <Eyebrow>This hand’s deck</Eyebrow>
          {["Shuffled with MagicBlock VRF", "Mixed with both players’ secrets", "Undealt cards readable by no one"].map((line) => (
            <div key={line} className="flex items-start gap-2.5 text-sm/relaxed">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-river" strokeWidth={2.6} />
              <span>{line}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </aside>
  );
}
