import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { fetchWithTimeout } from "@/lib/server/guard";
import { isBotRequest } from "@/lib/server/bot-auth";

const { refreshCallPerformance } = require("@/server/engine/performance");

/**
 * Price the call journal from Vercel, because the worker has nowhere to run.
 *
 * 1,780 of 1,781 journalled calls carry no price, so the marketplace shows no performance for
 * either approved source — the one fact a user needs before copying one. The scanner is not
 * missing: `server/engine/performance.js` is written, tested and correct. It simply only ever
 * ran inside the worker, and the worker's Railway trial expired and its deployments were torn
 * down. A working scanner and an empty journal, separated by a hosting bill.
 *
 * THE ENGINE IS NOT REIMPLEMENTED HERE. `refreshCallPerformance` takes its two side effects as
 * injected dependencies, so the same module the worker drives is driven here with a bridge
 * transport instead of a PostgREST one. Two copies of "what counts as a measured call" is how
 * this codebase has produced most of its silent defects; there is one copy, and it is that one.
 *
 * Bounded per run: a Vercel function has a wall clock, and DexScreener is rate limited. The
 * work list is ordered least-recently-scanned first, so consecutive runs walk the backlog
 * instead of rescanning the newest page forever.
 *
 * WHAT THIS CANNOT RECOVER, AND WHY THE MARKETPLACE WILL STILL LOOK THIN
 *
 * A return needs two prices: the one at the moment of the call, and the one now. This fills
 * the second. It cannot fill the first.
 *
 * 1,780 of the 1,781 journalled calls arrived through the Discord history backfill, which
 * recovers the message but not the market at the instant it was posted — `called_price_usd`
 * is null on all but one of them. Scanning gives those calls a current price and no return,
 * and `app_public_list_discord_marketplace` counts them as unmeasured, which is correct: a
 * multiple computed against a baseline nobody recorded would be invented.
 *
 * So the honest expectation is that measured counts climb from calls ingested LIVE from here,
 * not from the archive. Recovering historical baselines needs a provider with per-timestamp
 * history (DexScreener has none); that is a separate piece of work, not a tweak to this route.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Vercel plan permits one cron run per day, so the per-run page is the whole daily budget.
 * 200 is the ceiling `bot_calls_awaiting_scan` enforces server-side; the engine caches one
 * quote per distinct mint, so a page of 200 calls costs far fewer than 200 provider requests.
 *
 * The route is also reachable with bot credentials, so a backlog can be walked faster than
 * once a day without waiting on the schedule.
 */
const CALLS_PER_RUN = 200;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isCronRequest(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && timingSafeEqual(digest(expected!), digest(supplied!)));
}

async function bridge(operation: string, params: Record<string, unknown>) {
  const url = getBotBridgeUrl();
  if (!url) throw new Error("bot bridge is not configured");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: botBridgeHeaders,
    cache: "no-store",
    body: JSON.stringify({ operation, p_secret: process.env.BOT_SHARED_SECRET, ...params })
  }, 20_000);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `bridge operation failed (${response.status})`);
  return data;
}

export async function GET(req: NextRequest) {
  if (!isBotRequest(req) && !isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.BOT_SHARED_SECRET) {
    return NextResponse.json({ error: "call scanner is not configured" }, { status: 503 });
  }

  const counts: Record<string, number> = {};
  const errors: string[] = [];

  try {
    await refreshCallPerformance({
      loadPerformanceCalls: () => bridge("calls_awaiting_scan", { p_limit: CALLS_PER_RUN }),
      recordCallMarketScan: (id: string, quote: any) => bridge("record_call_scan", {
        p_call_id: id,
        p_provider: quote?.provider || "dexscreener",
        p_observed_at: quote?.observedAt || new Date().toISOString(),
        p_price_usd: quote?.priceUsd ?? null,
        p_market_cap_usd: quote?.marketCap ?? null,
        p_liquidity_usd: quote?.liquidityUsd ?? null,
        p_freshness: quote?.freshness || "unavailable"
      }),
      onEvent: (event: { type: string; error?: string }) => {
        counts[event.type] = (counts[event.type] || 0) + 1;
        // Keep a bounded sample of failures. A run where every write fails should say so once,
        // not five hundred times.
        if (event.error && errors.length < 5) errors.push(event.error);
      }
    });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "call performance scan failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    scanned: counts.PERFORMANCE_UPDATED || 0,
    unpriced: counts.PERFORMANCE_MISSING || 0,
    writeErrors: counts.PERFORMANCE_WRITE_ERROR || 0,
    errors
  });
}
