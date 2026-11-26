/** Card ids are 0..=51: rank = id % 13 (0 = Two .. 12 = Ace), suit = id / 13. */
export const RANKS = "23456789TJQKA";
export const SUITS = ["c", "d", "h", "s"] as const;

export interface Card {
  id: number;
  rank: string;
  suit: (typeof SUITS)[number];
}

export const card = (id: number): Card => ({
  id,
  rank: RANKS[id % 13],
  suit: SUITS[Math.floor(id / 13)],
});
