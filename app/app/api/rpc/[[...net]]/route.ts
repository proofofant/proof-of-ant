/**
 * JSON-RPC proxy: the browser talks to /api/rpc, so the keyed RPC URL ($RPC_URL) stays on
 * the server. Only the methods the app uses get through, with a per-IP request budget.
 * Any path suffix is ignored: the wallet adapter infers the wallet's network from the
 * endpoint text, so a devnet build points at /api/rpc/devnet.
 */
const UPSTREAM = process.env.RPC_URL;
const METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getBlockTime",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "getTokenAccountBalance",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getEpochInfo",
  "getVersion",
  "getGenesisHash",
  "isBlockhashValid",
  "simulateTransaction",
  "sendTransaction",
  // Only with an RPC that serves it (NEXT_PUBLIC_RPC_GPA=1).
  ...(process.env.NEXT_PUBLIC_RPC_GPA === "1" ? ["getProgramAccounts"] : []),
]);
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 20;
// Token bucket per IP: a mining tab polls a few calls every few seconds plus ~1 send/s.
const RATE = 25; // calls per second
const BURST = 200; // a page load backfills the event history in a burst
const buckets = new Map<string, { tokens: number; at: number }>();

function allow(ip: string, cost: number) {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: BURST, at: now };
  b.tokens = Math.min(BURST, b.tokens + ((now - b.at) / 1000) * RATE);
  b.at = now;
  buckets.set(ip, b);
  if (buckets.size > 10_000) buckets.clear();
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}

const error = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status });

export async function POST(request: Request) {
  if (!UPSTREAM) return error(503, "rpc not configured");
  const body = await request.text();
  if (body.length > MAX_BODY) return error(413, "request too large");
  let calls: { method?: unknown }[];
  try {
    const parsed = JSON.parse(body);
    calls = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return error(400, "bad json");
  }
  if (calls.length === 0 || calls.length > MAX_BATCH) return error(400, "bad batch");
  const bad = calls.find((c) => typeof c.method !== "string" || !METHODS.has(c.method));
  if (bad) return error(403, `method not allowed: ${String(bad.method)}`);
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
  if (!allow(ip, calls.length)) return error(429, "too many requests");

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });
}
