import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { callAppBridge } from "@/lib/server/app-bridge";
import { rpcResponse } from "@/lib/server/product";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  const scanner = await callAdminRpc("admin_scanner_health", {
    p_actor_privy_user_id: admin.privyUserId
  });
  if (scanner.ok) return rpcResponse(scanner);

  const journal = await callAppBridge<any>("app_public_list_discord_marketplace", {
    p_period: "1d", p_sort: "newest", p_limit: 100
  });
  if (!journal.ok) return rpcResponse(scanner);
  const sources = Array.isArray(journal.data?.sources) ? journal.data.sources : [];
  const calls = sources.reduce((sum: number, source: any) => sum + Number(source.totalCalls || 0), 0);
  const measured = sources.reduce((sum: number, source: any) => sum + Number(source.measuredCalls || 0), 0);
  const timestamps = sources
    .map((source: any) => source.dataFreshnessAt || source.lastSignalAt)
    .filter(Boolean)
    .sort();
  return NextResponse.json({
    ok: true,
    status: "live journal fallback",
    fallbackMode: "journal",
    tokenCount: calls,
    poolCount: measured,
    unsupportedPools: Math.max(0, calls - measured),
    quarantinedSignals24h: null,
    latestMarketSnapshotAt: timestamps[timestamps.length - 1] || null,
    latestRiskSnapshotAt: null
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
