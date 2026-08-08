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
    result.data.sources = (result.data.sources || []).map((source: any) => ({
      ...source,
      ...(byId.get(source.id) || {})
    }));
  }
  return rpcResponse(result);
}
