import { NextRequest, NextResponse } from "next/server";

/**
 * Zero-dependency per-IP rate limiter + input validators for API routes.
 * In-memory (fine for a single instance / free tier). For multi-instance production,
 * swap the Map for Upstash Redis — same interface.
 */
const BUCKET = new Map<string, { count: number; reset: number }>();

export function rateLimit(req: NextRequest, opts = { limit: 30, windowMs: 60_000 }) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
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

// Solana addresses are base58, 32–44 chars
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isMint = (s: unknown): s is string => typeof s === "string" && BASE58.test(s);

export function validAmount(raw: unknown, maxLamports = 100 * 1e9): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > maxLamports || !Number.isInteger(n)) return null;
  return n;
}

export function validSlippageBps(raw: unknown): number {
  const n = Number(raw ?? 300);
  if (!Number.isFinite(n) || n < 1) return 300;
  return Math.min(n, 2000); // cap at 20% to reject insane slippage
}
