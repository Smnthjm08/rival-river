import { programErrorName } from "@/lib/rival";

const COPY: Record<string, string> = {
  NotYourTurn: "It’s your opponent’s turn.",
  CannotCheck: "There’s a bet to call: call, raise or fold.",
  NothingToCall: "Nothing to call: check or bet.",
  RaiseTooSmall: "That raise is too small.",
  NotEnoughChips: "You don’t have enough chips for that.",
  OpponentAllIn: "Your opponent is all-in: call or fold.",
  OpponentIsCreator: "You can’t invite yourself.",
  ZeroStake: "Pick a stake above zero.",
  TableNotOpen: "This table isn’t waiting for an opponent any more.",
  TableNotLocked: "Both players need to stake before the match starts.",
  StakeChanged: "The stake changed since you opened this page. Check it, then join again.",
  MatchExpired: "The match deadline has passed. Refund the table instead.",
  RefundTooEarly: "Refunds aren’t open yet.",
  NothingToRefund: "Nothing to refund here.",
  MatchFinished: "The match is over: collect the winnings instead.",
  MatchNotFinished: "The match isn’t finished yet.",
  NotAPlayer: "This wallet doesn’t play at this table.",
  WrongMint: "Stakes must be in devnet USDC.",
  NoSignMessage: "Your wallet can’t sign messages. Play from the tab you staked in; it doesn’t need one.",
  WrongRollup: "The game landed on an unexpected rollup, so the app stopped. Please report this.",
};

/** One short sentence for a failed action, for a toast. */
export function friendlyError(e: unknown): string {
  const name = programErrorName(e);
  if (name && COPY[name]) return COPY[name];
  const text = String((e as { message?: string })?.message ?? e);
  if (/user rejected|rejected the request|cancel/i.test(text))
    return "You cancelled in your wallet.";
  if (/insufficient (funds|lamports)|custom program error: 0x1\b/i.test(text))
    return "Not enough USDC, or SOL for fees.";
  if (/timed out/i.test(text))
    return "The network is slow. Try again in a moment.";
  return "Something went wrong. Try again.";
}
