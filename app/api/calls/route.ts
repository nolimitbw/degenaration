import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { rateLimit } from "@/lib/server/guard";

// GET /api/calls -> { calls, groups, callers } ranked by real recorded performance
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const supa = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });

  const { data, error } = await supa.from("calls")
    .select("id,group_name,caller,mint,symbol,called_mcap,peak_mcap,called_at")
    .order("called_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ calls: [], groups: [], callers: [], note: "no calls table yet" });

  const calls = (data ?? []).map((c: any) => ({
    ...c,
    peakX: c.called_mcap && c.peak_mcap ? c.peak_mcap / c.called_mcap : null
  }));

  // aggregate by group and caller
  const agg = (keyName: "group_name" | "caller") => {
    const m = new Map<string, { name: string; calls: number; wins: number; sumX: number; best: number }>();
    for (const c of calls) {
      const k = c[keyName]; if (!k) continue;
      const cur = m.get(k) || { name: k, calls: 0, wins: 0, sumX: 0, best: 0 };
      cur.calls++; const x = c.peakX || 0;
      if (x >= 2) cur.wins++; cur.sumX += x; cur.best = Math.max(cur.best, x);
      m.set(k, cur);
    }
    return Array.from(m.values()).map((g) => ({
      name: g.name, calls: g.calls, hitRate: g.calls ? (g.wins / g.calls) * 100 : 0,
      avgX: g.calls ? g.sumX / g.calls : 0, bestX: g.best,
      points: g.sumX * 10 + g.wins * 5
    })).sort((a, b) => b.points - a.points);
  };

  return NextResponse.json({ calls, groups: agg("group_name"), callers: agg("caller") });
}
