import { PublicKey } from "@solana/web3.js";
import idl from "./idl/rival_river.json";

export const PROGRAM_ID = new PublicKey(idl.address);

/** Devnet USDC, the only stake token the program accepts. */
export const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const USDC_DECIMALS = 6;

export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC ?? "https://rpc.magicblock.app/devnet";
/** Answers getDelegationStatus: is the game on the rollup yet? */
export const ROUTER_RPC = "https://devnet-router.magicblock.app/";
/** The private (TEE) rollup the program delegates to. */
export const TEE_RPC = "https://devnet-tee.magicblock.app";

/** Mirrors the program: refund of a match in play opens this long after its deadline. */
export const SETTLE_GRACE_SECONDS = 10 * 60;

// Mirrors of the program's match rules (programs/rival_river/src/constants.rs).
export const STARTING_STACK = 100;
export const MAX_HANDS = 6;
/** Seconds to act before the other player can claim the timeout. */
export const TURN_SECONDS = 30;
/** [small, big] for hands 1..=6; sudden-death hands keep the last level. */
export const BLINDS: [number, number][] = [[5, 10], [10, 20], [20, 40], [30, 60], [40, 80], [50, 100]];
export const blindsFor = (handNumber: number) => BLINDS[Math.min(Math.max(handNumber, 1), MAX_HANDS) - 1];
