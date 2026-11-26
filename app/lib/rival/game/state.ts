import { Connection, PublicKey } from "@solana/web3.js";
import { program } from "../chain/program";
import { card, type Card } from "./cards";
import { matchKeys, type MatchKeys } from "../chain/pdas";

export type Phase =
  | "waiting"
  | "dealing"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "finished";
export type TableStatus =
  | "waitingForOpponent"
  | "locked"
  | "inPlay"
  | "settled"
  | "refunded";
type Pair<T> = [T, T];

export interface TableView {
  keys: MatchKeys;
  /** Each player's stake, in USDC base units (6 decimals). */
  stake: number;
  status: TableStatus;
  /** Unix seconds: when refund becomes possible. */
  deadline: number;
  /** Session keys named when staking, [creator, opponent]; null = none (yet). */
  sessionKeys: Pair<PublicKey | null>;
  /** Waiting for whoever has the invite link (no opponent named, nobody joined yet). */
  open: boolean;
  /** The invite link's public key, for open tables; null if the table is for a named wallet. */
  inviteKey: PublicKey | null;
}

/** Game, in plain JS types. Every pair is [creator, opponent]. */
export interface GameView {
  handNumber: number;
  players: Pair<PublicKey>;
  sessionKeys: Pair<PublicKey | null>;
  permissionsReady: boolean;
  /** Who has shown up at the table; hand 1 needs both. */
  checkedIn: Pair<boolean>;
  stacks: Pair<number>;
  bets: Pair<number>;
  pot: number;
  dealer: number;
  toAct: number;
  acted: Pair<boolean>;
  minRaise: number;
  phase: Phase;
  /** Face-up community cards only. */
  board: Card[];
  /** Both hole cards after a showdown, until the next hand starts. */
  shown: Pair<Pair<Card>> | null;
  /** Unix seconds: after this, claim_timeout is allowed. */
  deadline: number;
  matchDeadline: number;
  winner: number | null;
}

export interface HandView {
  /** Null until this hand's cards are dealt. */
  cards: Pair<Card> | null;
  hasSecret: boolean;
}

const variant = <T extends string>(e: object) => Object.keys(e)[0] as T;
const orNone = (ks: PublicKey[]) =>
  ks.map((k) =>
    k.equals(PublicKey.default) ? null : k
  ) as Pair<PublicKey | null>;
const num = (n: { toNumber(): number } | number) =>
  typeof n === "number" ? n : n.toNumber();

/** How many board cards are face up. Waiting after a showdown keeps all five. */
const BOARD_SHOWN: Record<Phase, number> = {
  waiting: 0,
  dealing: 0,
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  finished: 0,
};

export async function fetchTable(
  base: Connection,
  table: PublicKey
): Promise<TableView | null> {
  const info = await base.getAccountInfo(table);
  if (!info) return null;
  const t = program.coder.accounts.decode("table", info.data);
  return {
    keys: matchKeys(t.creator, t.opponent, t.tableId),
    stake: num(t.stake),
    status: variant<TableStatus>(t.status),
    deadline: num(t.deadline),
    sessionKeys: orNone(t.sessionKeys as PublicKey[]),
    open: (t.opponent as PublicKey).equals(PublicKey.default),
    inviteKey: (t.inviteKey as PublicKey).equals(PublicKey.default) ? null : (t.inviteKey as PublicKey),
  };
}

/** Reads Game from wherever it lives now: the TEE while delegated, else Solana. */
export async function fetchGame(
  conn: Connection,
  game: PublicKey
): Promise<GameView | null> {
  const info = await conn.getAccountInfo(game);
  if (!info || !info.owner.equals(program.programId)) return null;
  const g = program.coder.accounts.decode("game", info.data);
  const phase = variant<Phase>(g.phase);
  const shown = g.shown
    ? ((g.shown as number[][]).map((h) => h.map(card)) as Pair<Pair<Card>>)
    : null;
  const faceUp = shown ? 5 : BOARD_SHOWN[phase];
  return {
    handNumber: g.handNumber,
    players: g.players as Pair<PublicKey>,
    sessionKeys: orNone(g.sessionKeys as PublicKey[]),
    permissionsReady: g.permissionsReady,
    checkedIn: g.checkedIn as Pair<boolean>,
    stacks: g.stacks as Pair<number>,
    bets: g.bets as Pair<number>,
    pot: g.pot,
    dealer: g.dealer,
    toAct: g.toAct,
    acted: g.acted as Pair<boolean>,
    minRaise: g.minRaise,
    phase,
    board: (g.board as number[]).slice(0, faceUp).map(card),
    shown,
    deadline: num(g.deadline),
    matchDeadline: num(g.matchDeadline),
    winner: g.winner ?? null,
  };
}

/**
 * Your own Hand, through a TEE connection logged in as you. Null only when
 * the account isn't there; network and login errors (see isTeeAuthError)
 * throw, so a failed read never looks like "no cards".
 */
export async function fetchHand(
  tee: Connection,
  hand: PublicKey
): Promise<HandView | null> {
  const info = await tee.getAccountInfo(hand);
  if (!info) return null;
  const h = program.coder.accounts.decode("hand", info.data);
  return {
    cards: h.dealt ? ((h.cards as number[]).map(card) as Pair<Card>) : null,
    hasSecret: h.hasSecret,
  };
}

/**
 * Game plus your own Hand, as one snapshot. A Hand keeps the last hand's
 * cards until the next deal, so they're hidden while the next hand waits
 * for its shuffle.
 */
export async function fetchMatch(
  tee: Connection,
  keys: MatchKeys,
  seat: 0 | 1
) {
  const [game, hand] = await Promise.all([
    fetchGame(tee, keys.game),
    fetchHand(tee, seat === 0 ? keys.handCreator : keys.handOpponent),
  ]);
  if (game && hand && game.phase === "dealing") hand.cards = null;
  return { game, hand };
}
