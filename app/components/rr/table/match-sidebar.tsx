import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import { PlayingCard } from "@/components/rr/playing-card";
import { TableStage } from "@/components/rr/table/table-stage";
import { formatUsdc } from "@/hooks/use-usdc-balance";
import { STARTING_STACK, MAX_HANDS, type Card, type GameView, type HandResult, type MatchKeys } from "@/lib/rival";
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
  /** Turn controls or the hand's status: the dock right under the table, so no scrolling to act. */
  controls?: React.ReactNode;
  /** The felt. */
  children: React.ReactNode;
  /** A row above the felt (the preview's replay buttons). */
  toolbar?: React.ReactNode;
}

const Panel = ({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-3">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-heading text-base font-bold">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/** Cards under their own label, always on one line. */
export function CardGroup({ label, cards }: { label: string; cards: Card[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex gap-1">
        {cards.map((c) => (
          <PlayingCard key={c.id} card={c} width={40} />
        ))}
      </div>
    </div>
  );
}

/**
 * The table and its dock fill the first screen. Below them, for whoever
 * scrolls: what's at stake, how the match is going, and why the deck is fair.
 */
export function MatchSidebar({ game, me, names, stake, keys, results, lastResult, controls, children, toolbar }: MatchSidebarProps) {
  const opp = (1 - me) as 0 | 1;
  const byHand = new Map(results.map((r) => [r.handNumber, r]));
  const hands = Array.from({ length: MAX_HANDS }, (_, i) => i + 1);

  return (
    <>
      <TableStage toolbar={toolbar} felt={children} dock={controls} />

      <aside aria-label="Match details" className="grid gap-x-12 gap-y-10 border-t px-2 pt-8 pb-12 md:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        <Panel title="Escrow">
          <p className="text-sm/relaxed text-muted-foreground">
            {formatUsdc(stake)} USDC each, held in escrow on Solana. Bets are in chips, not USDC: win all{" "}
            {STARTING_STACK * 2} chips, or lead after {MAX_HANDS} hands, and you take the whole {formatUsdc(stake * 2)} USDC.
          </p>
          <a
            href={explorer("address", keys.vault.toBase58())}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 w-fit items-center gap-1.5 rounded-md text-sm font-semibold underline decoration-mist/60 underline-offset-4 hover:decoration-foreground"
          >
            View escrow account
            <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
          </a>
        </Panel>

        <Panel title={game.handNumber > MAX_HANDS ? `Sudden death, hand ${game.handNumber}` : "Match"}>
          <div className="grid grid-cols-6 gap-1.5">
            {hands.map((n) => {
              const r = byHand.get(n);
              const now = n === game.handNumber && game.phase !== "waiting" && game.phase !== "finished";
              const won = r?.won ? r.won[me] > 0 : null;
              const label = now ? "Now" : r ? (r.won ? (r.won[me] > 0 ? "Won" : r.won[me] < 0 ? "Lost" : "Split") : "Done") : String(n);
              return (
                <div key={n} className="flex flex-col items-center gap-1.5">
                  <div className={cn("h-2 w-full rounded-full", now ? "bg-river" : won === true ? "bg-brass" : r ? "bg-spent" : "bg-foreground/12")} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        {lastResult?.won && (
          <Panel
            title={`Hand ${lastResult.handNumber}`}
            aside={
              <span className={cn("font-mono text-base font-semibold", lastResult.won[me] > 0 ? "text-brass" : "text-muted-foreground")}>
                {lastResult.won[me] > 0 ? "+" : ""}
                {lastResult.won[me]}
              </span>
            }
          >
            <p className="text-sm">
              {lastResult.won[me] > 0 ? "You won the hand" : lastResult.won[me] < 0 ? `${names[opp]} won the hand` : "Split pot"}
              {lastResult.shown ? " at showdown." : `: ${lastResult.won[me] > 0 ? names[opp] : "you"} folded, cards stay sealed.`}
            </p>
            {lastResult.shown && (
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                <CardGroup label="You" cards={lastResult.shown[me]} />
                <CardGroup label="Board" cards={lastResult.board} />
              </div>
            )}
          </Panel>
        )}

        <Panel title="This hand’s deck">
          <ul className="flex flex-col gap-2.5">
            {["Shuffled with MagicBlock VRF", "Mixed with both players’ secrets", "Undealt cards readable by no one"].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-sm/relaxed">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-river" strokeWidth={2.6} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </>
  );
}
