import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { currentMultiple, peakMultiple, sourceMetrics, type PerformanceCall } from "@/lib/callPerformance";
import { UNVERIFIED_DEMO_GROUP_IDS } from "@/lib/callSources";
import { rateLimit } from "@/lib/server/guard";

const WINDOWS: Record<string, number | null> = { "7d": 7, "30d": 30, all: null };

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
}

function callQuery(supa: NonNullable<ReturnType<typeof client>>, since: string | null, legacy = false) {
  const fields = legacy
    ? "id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,called_at"
    : "id,group_id,group_name,caller,mint,symbol,called_mcap,peak_mcap,latest_mcap,called_price_usd,peak_price_usd,latest_price_usd,called_at";
  let query = supa.from("calls").select(fields).order("called_at", { ascending: false }).limit(1000);
  if (since) query = query.gte("called_at", since);
  return query;
}

// GET /api/call-sources?tf=7d|30d|all -> approved Discord sources with measured call performance.
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const supa = client();
  if (!supa) return NextResponse.json({ sources: [], note: "database not configured" }, { status: 503 });

  const tf = req.nextUrl.searchParams.get("tf") || "30d";
  const days = WINDOWS[tf] === undefined ? 30 : WINDOWS[tf];
  const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const { data: groups, error: groupsError } = await supa
    .from("approved_groups")
    .select("id,name,members,tag,public_slug,referral_code,created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (groupsError) return NextResponse.json({ sources: [], note: "no approved groups table yet" });

  const primary = await callQuery(supa, since);
  const fallback = primary.error ? await callQuery(supa, since, true) : null;
  const calls = ((fallback?.data ?? primary.data ?? []) as unknown) as PerformanceCall[];
  const byGroup = new Map<string, PerformanceCall[]>();
  for (const call of calls) {
    if (!call.group_id) continue;
    const list = byGroup.get(call.group_id) ?? [];
    list.push(call);
    byGroup.set(call.group_id, list);
  }

  const visibleGroups = (groups ?? []).filter((group: any) => !UNVERIFIED_DEMO_GROUP_IDS.has(group.id));
  const hiddenDemoSources = (groups?.length ?? 0) - visibleGroups.length;
  const sources = visibleGroups.map((group: any) => {
    const sourceCalls = byGroup.get(group.id) ?? [];
    return {
      id: group.id,
      name: group.name,
      members: group.members,
      tag: group.tag,
      publicSlug: group.public_slug,
      referralCode: group.referral_code,
      createdAt: group.created_at,
      metrics: sourceMetrics(sourceCalls),
      recentCalls: sourceCalls.slice(0, 5).map((call) => ({
        id: call.id,
        mint: call.mint,
        symbol: call.symbol,
        caller: call.caller,
        calledAt: call.called_at,
        peakX: peakMultiple(call),
        currentX: currentMultiple(call)
      }))
    };
  }).sort((a, b) => (b.metrics.avgPeakX ?? 0) - (a.metrics.avgPeakX ?? 0));

  return NextResponse.json({ sources, timeframe: tf, scannedAt: new Date().toISOString(), hiddenDemoSources });
}
