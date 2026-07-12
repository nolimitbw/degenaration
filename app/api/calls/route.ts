import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { peakMultiple, sourceMetrics, type PerformanceCall } from "@/lib/callPerformance";
import { rateLimit } from "@/lib/server/guard";

// GET /api/calls?tf=1h|1d|7d|30d -> { calls, groups, callers } ranked by real recorded performance
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ calls: [], groups: [], callers: [], note: "database not configured" }, { status: 503 });
  const supa = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });

  const tf = req.nextUrl.searchParams.get("tf") || "1d";
  const now = Date.now();
  const tfMs: Record<string, number> = { "1h": 3600000, "1d": 86400000, "7d": 604800000, "30d": 2592000000 };
  const since = tfMs[tf] ? new Date(now - tfMs[tf]).toISOString() : new Date(now - 86400000).toISOString();

  const primary = await supa.from("calls")
    .select("id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,latest_mcap,called_price_usd,peak_price_usd,latest_price_usd,called_at")
    .gte("called_at", since)
    .order("called_at", { ascending: false }).limit(200);
  const fallback = primary.error ? await supa.from("calls")
    .select("id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,called_at")
    .gte("called_at", since)
    .order("called_at", { ascending: false }).limit(200) : null;
  const error = fallback ? fallback.error : primary.error;
  if (error) return NextResponse.json({ calls: [], groups: [], callers: [], note: "no calls table yet" });

  const calls = (((fallback?.data ?? primary.data ?? []) as unknown) as PerformanceCall[]).map((c) => ({
    ...c,
    peakX: peakMultiple(c)
  }));

  // aggregate by group and caller
  const agg = (keyName: "group_name" | "caller") => {
    const m = new Map<string, PerformanceCall[]>();
    for (const c of calls) {
      const key = c[keyName]; if (!key) continue;
      const sourceCalls = m.get(key) ?? [];
      sourceCalls.push(c); m.set(key, sourceCalls);
    }
    return Array.from(m.entries()).map(([name, sourceCalls]) => {
      const metrics = sourceMetrics(sourceCalls);
      return {
        name, calls: metrics.calls, measuredCalls: metrics.measuredCalls, hitRate: metrics.hitRate ?? 0,
        avgX: metrics.avgPeakX ?? 0, bestX: metrics.bestPeakX ?? 0,
        points: (metrics.avgPeakX ?? 0) * 10 + (metrics.hitRate ?? 0) / 10
      };
    }).sort((a, b) => b.points - a.points);
  };

  return NextResponse.json({ calls, groups: agg("group_name"), callers: agg("caller") });
}
