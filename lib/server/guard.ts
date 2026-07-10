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

// u64 max — the largest token amount Solana can represent.
const U64_MAX = BigInt("18446744073709551615");
// Fat-finger guard for SOL-denominated inputs (buys): 100 SOL in lamports.
const MAX_SOL_LAMPORTS = BigInt(100) * BigInt(1_000_000_000);
const ZERO = BigInt(0);

/**
 * Validate a swap input amount in the input token's BASE UNITS, returned as an exact
 * decimal string (no float precision loss — token balances routinely exceed 2^53).
 * When `isSolInput` is true the amount is SOL lamports, so we also apply the 100-SOL
 * fat-finger cap; token sells are only bounded by u64 so a whale can fully exit a position.
 */
export function validBaseUnits(raw: unknown, isSolInput: boolean): string | null {
  let v: bigint;
  try {
    if (typeof raw === "string") { if (!/^\d+$/.test(raw.trim())) return null; v = BigInt(raw.trim()); }
    else if (typeof raw === "number") { if (!Number.isInteger(raw) || raw <= 0) return null; v = BigInt(raw); }
    else return null;
  } catch { return null; }
  if (v <= ZERO || v > U64_MAX) return null;
  if (isSolInput && v > MAX_SOL_LAMPORTS) return null;
  return v.toString();
}

export function validSlippageBps(raw: unknown): number {
  const n = Number(raw ?? 300);
  if (!Number.isFinite(n) || n < 1) return 300;
  return Math.min(n, 2000); // cap at 20% to reject insane slippage
}

const FETCH_TIMEOUT_MS = 15_000;
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

export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^.*Error:\s*/i, "").split("\n")[0].slice(0, 200);
}
