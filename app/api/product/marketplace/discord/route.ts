import { NextRequest, NextResponse } from "next/server";
import { callAppBridge } from "@/lib/server/app-bridge";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { normalizePeriod, rpcResponse } from "@/lib/server/product";

const SORTS = new Set(["performance", "drawdown", "followers", "calls", "newest", "fee"]);

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  const period = normalizePeriod(req.nextUrl.searchParams.get("period"), ["1d", "7d", "30d"], "7d");
  const requestedSort = req.nextUrl.searchParams.get("sort") || "performance";
  const sort = SORTS.has(requestedSort) ? requestedSort : "performance";
  const [marketplaceResult, journalResult] = await Promise.allSettled([
    callAppBridge<any>("app_public_list_discord_marketplace", {
      p_period: period, p_sort: sort, p_limit: 100
    }),
    callAppBridge<any>("app_public_discord_journal_stats", { p_period: period })
  ]);
  if (marketplaceResult.status === "rejected") {
    return NextResponse.json({ error: "Source data is temporarily unavailable" }, { status: 502 });
  }
  const result = marketplaceResult.value;
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (journalResult.status === "fulfilled" && journalResult.value.ok) {
    const byId = new Map((journalResult.value.data?.sources || []).map((source: any) => [source.id, source]));
    result.data.sources = (result.data.sources || []).map((source: any) => {
      const journal = { ...(byId.get(source.id) || {}) } as Record<string, unknown>;
      // The two RPCs both compute "measured" and they do NOT agree: the marketplace counts
      // calls that have a peak ratio, the journal counts performance_status = 'measured'. A
      // call backfilled since the scanner last ran has the first and not the second, so the
      // journal reported 21 while the distribution it labels was built from 22 — the caption
      // under a chart describing a different population than the chart.
      //
      // The marketplace RPC owns this family, because the buckets, the hit rate and the
      // medians are all derived from exactly the same rows in that query. The journal keeps
      // everything else it is better at: activity, freshness, delivery counts.
      for (const owned of ["measuredCalls", "measuredCurrent", "winRate", "currentWinRate"]) {
        delete journal[owned];
      }
      return { ...source, ...journal };
    });
  }
  return rpcResponse(result);
}
