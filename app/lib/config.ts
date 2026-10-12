import { PublicKey } from "@solana/web3.js";

export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet";
/**
 * Browser RPC. A path such as "/api/rpc" goes through this site's own proxy, which keeps
 * the real (keyed) RPC URL on the server; a full URL is used directly (localnet).
 */
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8899";
export const RPC_URL = RPC.startsWith("/")
  ? `${typeof window === "undefined" ? "http://localhost" : window.location.origin}${RPC}`
  : RPC;
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "6XpBQEvCBfx4WM1iGDpUyFGkGXVTXXxcp7pvV6uZEhUU"
);
export const MINT = process.env.NEXT_PUBLIC_MINT
  ? new PublicKey(process.env.NEXT_PUBLIC_MINT)
  : null;
export const DECIMALS = Number(process.env.NEXT_PUBLIC_TOKEN_DECIMALS ?? 6);
export const TICKER = process.env.NEXT_PUBLIC_TICKER ?? "ANT";
export const IS_LOCAL = CLUSTER === "localnet";
/** Public RPCs rate-limit hard: poll less often off localnet. */
export const POLL_SCALE = IS_LOCAL ? 1 : 2.5;
/** Dev conveniences (burner wallet, faucet, network label): localnet, or NEXT_PUBLIC_DEV_TOOLS=1. */
export const IS_TEST = IS_LOCAL || process.env.NEXT_PUBLIC_DEV_TOOLS === "1";
/** What the faucet hands out, for the wallet menu. */
export const FAUCET_LABEL = IS_LOCAL ? "2 SOL + 5,000 tokens" : "0.1 SOL + 5,000 test tokens";
