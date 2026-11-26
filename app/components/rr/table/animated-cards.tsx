"use client";

import { motion } from "motion/react";
import type { Card } from "@/lib/rival";
import { PlayingCard, type CardSize } from "@/components/rr/playing-card";
import { cn } from "@/lib/utils";

/** A gentle ease-out shared by the flips. */
const FLIP = { duration: 0.45, ease: [0.3, 0.7, 0.2, 1] as const };

/**
 * Turns from face down to face up when it mounts. The back is a sealed card
 * on the reverse side, so the turn reads as a real card flipping.
 */
function Flip({ card, width, delay }: { card: Card; width: CardSize; delay: number }) {
  return (
    <motion.div
      className="relative"
      style={{ transformStyle: "preserve-3d" }}
      initial={{ rotateY: 180 }}
      animate={{ rotateY: 0 }}
      transition={{ ...FLIP, delay }}
    >
      <div style={{ backfaceVisibility: "hidden" }}>
        <PlayingCard card={card} width={width} />
      </div>
      <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
        <PlayingCard faceDown width={width} />
      </div>
    </motion.div>
  );
}

/**
 * A hole card dealt from the deck in the middle of the table: it flies in
 * from `from` (px, relative to where it lands), then turns face up if it's
 * yours. Mount it once per hand (key it by hand number) to replay the deal.
 */
export function DealtCard({
  card,
  width,
  from,
  delay = 0,
  className,
}: {
  /** Null: stays face down (the opponent's). */
  card: Card | null;
  width: CardSize;
  from: { x: number; y: number };
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={cn("[perspective:900px]", className)}
      initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.6, rotate: -12 }}
      animate={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 24, delay }}
    >
      {card ? <Flip card={card} width={width} delay={delay + 0.35} /> : <PlayingCard faceDown width={width} />}
    </motion.div>
  );
}

/** A community card turned over where it lies. Key it by hand and slot. */
export function RevealedCard({ card, width, delay = 0 }: { card: Card; width: CardSize; delay?: number }) {
  return (
    <motion.div
      className="[perspective:900px]"
      initial={{ y: -10, opacity: 0.6 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.25, delay }}
    >
      <Flip card={card} width={width} delay={delay} />
    </motion.div>
  );
}

/**
 * The deck being riffled in the middle of the table while the hand is
 * shuffled: halves split left and right and fall back together, on a loop.
 */
export function ShufflingDeck({ label }: { label: string }) {
  const cards = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div className="flex flex-col items-center gap-4" role="status" aria-label={label}>
      <div className="relative h-[90px] w-16">
        {cards.map((i) => {
          const side = i % 2 === 0 ? -1 : 1;
          return (
            <motion.div
              key={i}
              className="absolute inset-0"
              style={{ zIndex: i }}
              initial={{ x: 0, y: -i * 1.5 }}
              animate={{
                x: [0, side * 62, side * 62, 0],
                y: [-i * 1.5, -i * 1.5 - 6, -i * 1.5 - 6, -i * 1.5],
                rotate: [0, side * 9, side * 4, 0],
              }}
              transition={{ duration: 1.2, times: [0, 0.35, 0.6, 1], ease: "easeInOut", delay: i * 0.05, repeat: Infinity, repeatDelay: 0.35 }}
            >
              <PlayingCard faceDown width={64} />
            </motion.div>
          );
        })}
      </div>
      <span className="text-sm font-semibold tracking-[0.12em] text-mist uppercase">{label}</span>
    </div>
  );
}
