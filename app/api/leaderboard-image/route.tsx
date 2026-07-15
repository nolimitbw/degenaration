import { ImageResponse } from "next/og";
import { peakMultiple, sourceMetrics, type PerformanceCall } from "@/lib/callPerformance";

export const dynamic = "force-dynamic";

async function weeklyGroups() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  const endpoint = new URL(`${url}/rest/v1/calls`);
  endpoint.searchParams.set("select", "id,group_name,called_mcap,peak_mcap,called_price_usd,peak_price_usd,called_at");
  endpoint.searchParams.set("called_at", `gte.${new Date(Date.now() - 7 * 86_400_000).toISOString()}`);
  endpoint.searchParams.set("order", "called_at.desc");
  endpoint.searchParams.set("limit", "1000");
  const response = await fetch(endpoint, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!response.ok) return [];
  const calls = (await response.json()) as PerformanceCall[];
  const groups = new Map<string, PerformanceCall[]>();
  for (const call of calls) {
    const name = call.group_name?.trim();
    if (!name) continue;
    const list = groups.get(name) || [];
    list.push(call);
    groups.set(name, list);
  }
  return [...groups.entries()].map(([name, sourceCalls]) => {
    const metrics = sourceMetrics(sourceCalls);
    return { name, metrics, best: sourceCalls.map(peakMultiple).filter((value): value is number => value != null).sort((a, b) => b - a)[0] ?? null };
  }).sort((a, b) => ((b.metrics.avgPeakX || 0) * 10 + (b.metrics.hitRate || 0) / 10) - ((a.metrics.avgPeakX || 0) * 10 + (a.metrics.hitRate || 0) / 10)).slice(0, 5);
}

export async function GET() {
  const groups = await weeklyGroups();
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#080a0d", color: "#f3f5f7", padding: "54px 60px", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #242a32", paddingBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 34, fontWeight: 800 }}>DEGEN<span style={{ color: "#ee315d" }}>ARATION</span></div>
        <div style={{ display: "flex", color: "#929ba8", fontSize: 18 }}>WEEKLY CALL LEADERBOARD</div>
      </div>
      {groups.length ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
          {groups.map((group, index) => (
            <div key={group.name} style={{ display: "flex", alignItems: "center", height: 78, borderBottom: "1px solid #20262d" }}>
              <div style={{ display: "flex", width: 62, color: index === 0 ? "#38bdf8" : "#929ba8", fontSize: 25, fontWeight: 800 }}>#{index + 1}</div>
              <div style={{ display: "flex", flex: 1, fontSize: 25, fontWeight: 700 }}>{group.name}</div>
              <div style={{ display: "flex", width: 150, flexDirection: "column" }}><span style={{ color: "#929ba8", fontSize: 12 }}>CALLS</span><span style={{ marginTop: 4, fontSize: 20 }}>{group.metrics.calls}</span></div>
              <div style={{ display: "flex", width: 170, flexDirection: "column" }}><span style={{ color: "#929ba8", fontSize: 12 }}>2X HIT RATE</span><span style={{ marginTop: 4, fontSize: 20 }}>{group.metrics.hitRate == null ? "Pending" : `${group.metrics.hitRate.toFixed(0)}%`}</span></div>
              <div style={{ display: "flex", width: 150, flexDirection: "column" }}><span style={{ color: "#929ba8", fontSize: 12 }}>AVG PEAK</span><span style={{ marginTop: 4, color: "#42d392", fontSize: 20 }}>{group.metrics.avgPeakX == null ? "Pending" : `${group.metrics.avgPeakX.toFixed(2)}x`}</span></div>
              <div style={{ display: "flex", width: 130, flexDirection: "column" }}><span style={{ color: "#929ba8", fontSize: 12 }}>BEST</span><span style={{ marginTop: 4, color: "#38bdf8", fontSize: 20 }}>{group.best == null ? "Pending" : `${group.best.toFixed(2)}x`}</span></div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center" }}><div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>No ranked calls this week</div><div style={{ display: "flex", marginTop: 12, color: "#929ba8", fontSize: 18 }}>Only approved, recorded Discord calls appear here.</div></div>
      )}
      <div style={{ display: "flex", marginTop: "auto", alignItems: "center", justifyContent: "space-between", color: "#929ba8", fontSize: 14 }}><span>Measured from recorded entry to observed peak</span><span>degenaration.vercel.app</span></div>
    </div>,
    { width: 1200, height: 630, headers: { "Content-Disposition": "inline; filename=degenaration-weekly.png", "Cache-Control": "public, max-age=300" } }
  );
}
