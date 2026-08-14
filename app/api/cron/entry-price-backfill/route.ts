import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { fetchWithTimeout } from "@/lib/server/guard";
import { isBotRequest } from "@/lib/server/bot-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Entry-price backfill.
 *
 * 2,292 of 2,293 calls had no `called_price_usd`, so nothing could be measured and every
 * marketplace figure read "Collecting data". Not a rendering problem — the number genuinely
 * was not there.
 *
 * The reason was right at the time: the history scanner recovers a message but DexScreener
 * only answers with the price NOW, and stamping today's price on a three-week-old call would
 * invent the source's entire track record. `isHistorical` refuses to do that and still does.
 *
 * What changed is the evidence available, not the rule. GeckoTerminal serves minute-level
 * OHLCV per pool — free, no key — so the price AT THE CALL MINUTE is a fact to look up rather
 * than a number to guess. Recording it is the same measurement taken late.
 *
 * Three things keep it honest:
 *   - the candle used is the one CONTAINING the call, and its OPEN, not a later close;
 *   - `bot_record_call_entry_price` writes only where the price is still null, so a baseline
 *     captured live can never be overwritten by a looked-up one;
 *   - the source is recorded on the row as `ohlcv-backfill`, so any measured return can be
 *     traced to how its baseline was obtained.
 */

// GeckoTerminal's free tier is about 30 calls/minute. Pacing well under it: a backfill is not
// worth getting the whole platform's price data rate-limited for.
const REQUEST_SPACING_MS = 2_400;
const BUDGET_MS = 50_000;
const CALLS_PER_RUN = 40;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isCronRequest(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && timingSafeEqual(digest(expected), digest(supplied)));
}

async function bridge(operation: string, params: Record<string, unknown>) {
  const url = getBotBridgeUrl();
  if (!url) throw new Error("bot bridge is not configured");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: botBridgeHeaders,
    cache: "no-store",
    body: JSON.stringify({ operation, p_secret: process.env.BOT_SHARED_SECRET, ...params })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `bridge operation failed (${response.status})`);
  return data;
}

const gecko = (path: string) =>
  fetchWithTimeout(`https://api.geckoterminal.com/api/v2${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store"
  }, 12_000);

/** The deepest pool for a mint. Cached per run — many calls name the same token. */
async function deepestPool(mint: string): Promise<{ address: string; liquidity: number | null } | null> {
  const response = await gecko(`/networks/solana/tokens/${mint}/pools`);
  if (!response.ok) return null;
  const pools = (await response.json().catch(() => null))?.data || [];
  let best: { address: string; liquidity: number | null } | null = null;
  for (const pool of pools) {
    const address = pool?.attributes?.address;
    if (typeof address !== "string") continue;
    const liquidity = Number(pool?.attributes?.reserve_in_usd);
    const value = Number.isFinite(liquidity) ? liquidity : null;
    // Deepest pool, for the same reason ingestion picks it: a thin pool's last print is not a
    // price anyone could have traded at.
    if (!best || (value ?? 0) > (best.liquidity ?? 0)) best = { address, liquidity: value };
  }
  return best;
}

/**
 * The open of the minute candle CONTAINING the call.
 *
 * `before_timestamp` is exclusive-ish and returns candles at or before it, newest first. Asking
 * for `calledAt + 60` therefore puts the call's own minute at the head of the list. The OPEN is
 * used rather than the close because the call happened somewhere inside that minute, and the
 * open is the price that had already been trading when it landed — the close can be a move the
 * call itself caused.
 */
async function priceAt(pool: string, calledAtMs: number): Promise<number | null> {
  const seconds = Math.floor(calledAtMs / 1000);
  const response = await gecko(
    `/networks/solana/pools/${pool}/ohlcv/minute?before_timestamp=${seconds + 60}&limit=3&currency=usd`
  );
  if (!response.ok) return null;
  const list = (await response.json().catch(() => null))?.data?.attributes?.ohlcv_list || [];
  for (const row of list) {
    const [ts, open] = row || [];
    if (typeof ts !== "number") continue;
    // The candle must actually contain the call; a candle from an hour later is not its price.
    if (ts > seconds + 60 || ts < seconds - 120) continue;
    const value = Number(open);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!isBotRequest(req) && !isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.BOT_SHARED_SECRET) {
    return NextResponse.json({ error: "backfill is not configured" }, { status: 503 });
  }

  const started = Date.now();
  const counts = { considered: 0, priced: 0, noPool: 0, noCandle: 0, failed: 0 };
  const poolCache = new Map<string, { address: string; liquidity: number | null } | null>();

  try {
    const claimed = await bridge("calls_awaiting_entry_price", { p_limit: CALLS_PER_RUN });
    const rows: any[] = Array.isArray(claimed) ? claimed : [];

    for (const row of rows) {
      if (Date.now() - started > BUDGET_MS) break;
      counts.considered += 1;
      const mint = String(row?.mint || "");
      const calledAt = Date.parse(row?.called_at);
      if (!mint || !Number.isFinite(calledAt)) { counts.failed += 1; continue; }

      try {
        if (!poolCache.has(mint)) {
          poolCache.set(mint, await deepestPool(mint));
          await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
        }
        const pool = poolCache.get(mint);
        if (!pool) { counts.noPool += 1; continue; }

        const price = await priceAt(pool.address, calledAt);
        await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
        if (price == null) { counts.noCandle += 1; continue; }

        const result = await bridge("record_call_entry_price", {
          p_call_id: row.id,
          p_price_usd: price,
          p_market_cap_usd: null,
          p_liquidity_usd: pool.liquidity
        });
        if (result?.ok) counts.priced += 1; else counts.failed += 1;
      } catch {
        counts.failed += 1;
      }
    }

    return NextResponse.json(
      { ok: true, elapsedMs: Date.now() - started, claimed: rows.length, ...counts },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: String((error as Error)?.message || error).slice(0, 300), ...counts },
      { status: 502 }
    );
  }
}
