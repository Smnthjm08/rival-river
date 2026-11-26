import { LockIcon } from "lucide-react";
import type { Card } from "@/lib/rival";
import { cn } from "@/lib/utils";

// Kit suit glyphs, drawn on a 24×24 grid.
const PATHS = {
  s: "M12 2C9.5 5.6 4 9.4 4 13.6c0 2.7 2.1 4.6 4.6 4.6 1.2 0 2.3-.5 3-1.3-.2 2-1 3.6-2.4 5.1h5.6c-1.4-1.5-2.2-3.1-2.4-5.1.7.8 1.8 1.3 3 1.3 2.5 0 4.6-1.9 4.6-4.6C20 9.4 14.5 5.6 12 2z",
  h: "M12 21.2C7.1 17.2 3 13.6 3 9.1 3 6.1 5.3 3.8 8.2 3.8c1.6 0 3 .8 3.8 2 .8-1.2 2.2-2 3.8-2 2.9 0 5.2 2.3 5.2 5.3 0 4.5-4.1 8.1-9 12.1z",
  d: "M12 2.2 19.6 12 12 21.8 4.4 12z",
  c: "M12 2.5A4.3 4.3 0 0 0 8.1 8.6A4.4 4.4 0 1 0 10.8 16c-.2 2.4-1 4.3-2.4 6h7.2c-1.4-1.7-2.2-3.6-2.4-6A4.4 4.4 0 1 0 15.9 8.6A4.3 4.3 0 0 0 12 2.5z",
};
const SUIT_NAMES = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const RANK_NAMES: Record<string, string> = { A: "Ace", K: "King", Q: "Queen", J: "Jack", "10": "Ten" };

/**
 * Card size: a width in px, or a preset for the felt. Presets shrink with the
 * felt's width, and with the height left once seats, bets and pot are placed
 * (the px subtracted below), so the whole table fits one screen. Kit sizes are
 * the ceilings: hand 96, board 84, opponent 58.
 */
export type CardSize = number | "board" | "hand" | "opp";

export const CARD_PRESETS = {
  board: "[--cw:min(17cqw,84px,calc((100cqh_-_250px)*0.32))] md:[--cw:min(84px,calc((100cqh_-_220px)*0.3))]",
  hand: "[--cw:min(23cqw,96px,calc((100cqh_-_250px)*0.4))] md:[--cw:min(96px,calc((100cqh_-_220px)*0.36))]",
  opp: "[--cw:min(13cqw,7.5cqh,58px)] md:[--cw:min(58px,10.5cqh)]",
};

/** Everything inside a card scales from --cw through em units, as in the kit. */
function sizing(size: CardSize) {
  const style: React.CSSProperties = { width: "var(--cw)", height: "calc(var(--cw) * 1.4)", fontSize: "calc(var(--cw) / 10)" };
  if (typeof size === "number") return { className: "", style: { ...style, ["--cw" as string]: `${size}px` } };
  return { className: CARD_PRESETS[size], style };
}

interface PlayingCardProps {
  /** Null or omitted with faceDown: a sealed card. */
  card?: Card | null;
  faceDown?: boolean;
  /** Width in px or a responsive preset; height follows at 1.4×. */
  width?: CardSize;
  /** Part of the winning hand. */
  highlight?: boolean;
  /** Not used, or folded. */
  dim?: boolean;
  /** "Only you" badge under your own hole cards. */
  privateBadge?: boolean;
  className?: string;
}

/**
 * One card. Everything scales from `width` through em units, as in the kit.
 */
export function PlayingCard({ card, faceDown = false, width = 84, highlight, dim, privateBadge, className }: PlayingCardProps) {
  const sealed = faceDown || !card;
  const rank = card ? (card.rank === "T" ? "10" : card.rank) : "";
  const red = card && (card.suit === "h" || card.suit === "d");
  const isFace = rank === "J" || rank === "Q" || rank === "K";
  const label = sealed ? "Sealed card" : `${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[card!.suit]}`;
  const path = card ? PATHS[card.suit] : PATHS.s;
  const size = sizing(width);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "relative shrink-0 rounded-[0.8em] font-heading transition-opacity",
        highlight ? "shadow-card-won" : "shadow-card-face",
        dim && "opacity-35",
        red ? "text-ember" : "text-card-ink",
        size.className,
        className,
      )}
      style={size.style}
    >
      {sealed ? (
        <div className="absolute inset-0 overflow-hidden rounded-[0.8em] border-[0.45em] border-bone bg-felt">
          <svg viewBox="0 0 100 140" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full">
            <g fill="none" stroke="var(--river)" strokeOpacity="0.38" strokeWidth="2.2" strokeLinecap="round">
              {[10, 23, 36, 49, 62, 75, 88, 101, 114, 127].map((y) => (
                <path key={y} d={`M-10 ${y} Q 2.5 ${y - 7} 15 ${y} T 40 ${y} T 65 ${y} T 90 ${y} T 115 ${y}`} />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex size-[4.6em] items-center justify-center rounded-full border-[0.2em] border-brass bg-ink text-brass">
              <span className="text-[1.7em] font-extrabold tracking-[-0.07em]">RR</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 overflow-hidden rounded-[0.8em] border-[0.1em] border-card-edge bg-bone">
          <div className="absolute top-[0.55em] left-[0.7em] flex flex-col items-center gap-[0.2em]">
            <span className="text-[2.8em] leading-[0.95] font-bold tracking-[-0.05em]">{rank}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.9em]">
              <path d={path} fill="currentColor" />
            </svg>
          </div>
          {isFace ? (
            <div className="absolute right-[0.6em] bottom-[0.6em] flex h-[7.8em] w-[6.2em] flex-col items-center justify-center gap-[0.3em] rounded-[0.55em] border-[0.14em] border-current bg-brass/20">
              <span className="text-[4.6em] leading-[0.85] font-extrabold tracking-[-0.04em]">{rank}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-[1.7em]">
                <path d={path} fill="currentColor" />
              </svg>
            </div>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute right-[0.45em] bottom-[0.45em] size-[6.4em]">
              <path d={path} fill="currentColor" />
            </svg>
          )}
        </div>
      )}
      {privateBadge && !sealed && (
        <div className="absolute -bottom-[0.9em] left-1/2 flex -translate-x-1/2 items-center gap-[0.3em] rounded-full border-[0.08em] border-river bg-ink px-[0.6em] py-[0.25em] font-sans text-[0.95em] font-semibold whitespace-nowrap text-river">
          <LockIcon aria-hidden="true" className="size-[1.1em]" strokeWidth={2.4} />
          <span>Only you</span>
        </div>
      )}
    </div>
  );
}

/** A board slot with nothing dealt yet. */
export function EmptyCardSlot({ width = 84, label }: { width?: CardSize; label: string }) {
  const size = sizing(width);
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("shrink-0 rounded-[0.8em] border-2 border-dashed border-mist/30", size.className)}
      style={size.style}
    />
  );
}
