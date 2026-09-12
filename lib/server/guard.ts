import { NextRequest, NextResponse } from "next/server";

/**
 * Zero-dependency per-IP rate limiter + input validators for API routes.
 * In-memory (fine for a single instance / free tier). For multi-instance production,
 * swap the Map for Upstash Redis — same interface.
 */
const BUCKET = new Map<string, { count: number; reset: number }>();

// Entries were only ever overwritten, never removed, so the map grew by one per distinct
// ip+path and never shrank — every visitor a permanent allocation for the life of the
// instance. Serverless recycling hid it; a long-lived instance would not be so lucky.
// Sweeping only when the map is large keeps the common request path allocation-free.
const BUCKET_SWEEP_THRESHOLD = 5000;

function sweepExpired(now: number) {
  if (BUCKET.size < BUCKET_SWEEP_THRESHOLD) return;
  for (const [key, entry] of BUCKET) {
    if (now > entry.reset) BUCKET.delete(key);
  }
}

export function rateLimit(req: NextRequest, opts = { limit: 30, windowMs: 60_000 }) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  sweepExpired(now);
  const key = `${ip}:${new URL(req.url).pathname}`;
  const cur = BUCKET.get(key);
  if (!cur || now > cur.reset) {
    BUCKET.set(key, { count: 1, reset: now + opts.windowMs });
    return null;
  }
  cur.count++;
  if (cur.count > opts.limit) {
    const retry = Math.ceil((cur.reset - now) / 1000);
    return NextResponse.json(
      { error: "rate limit exceeded" },
      { status: 429, headers: { "retry-after": String(retry) } }
    );
  }
  return null;
}

// The pure validators moved to lib/server/input-rules.js so the plain-node test runner can
// require them — same reason fee-model, numeric-input and withdrawal live in .js. Re-exported
// here so every route importing "@/lib/server/guard" is unaffected and this module's public
// API is unchanged.
export {
  isMint,
  validAmount,
  validBaseUnits,
  validSlippageBps,
  sanitizeError
} from "@/lib/server/input-rules";

const FETCH_TIMEOUT_MS = 30_000;
export async function fetchWithTimeout(url: string | URL | Request, options?: RequestInit, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Test seam: the bucket is module-local and would otherwise be unobservable. */
export function __rateLimitBucketSize(): number {
  return BUCKET.size;
}
