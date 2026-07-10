import { NextRequest, NextResponse } from "next/server";
import { rateLimit, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

/**
 * POST /api/checkalerts  body: { alerts: [{ id, mint, kind, target }] }
 * kind: "above" | "below" (price). Returns which alerts have triggered now (live price).
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ triggered: [] }); }
  const alerts: any[] = Array.isArray(body?.alerts) ? body.alerts.slice(0, 30) : [];
  const mints = [...new Set(alerts.map(a => a.mint))];
  const triggered: string[] = [];
  try {
    if (mints.length) {
      const data = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`, { cache: "no-store" }).then(r => r.json());
      const price: Record<string, number> = {};
      for (const p of data?.pairs ?? []) {
        const a = p.baseToken?.address; const v = Number(p.priceUsd);
        if (a && (!price[a] || (p.liquidity?.usd || 0) > 0)) price[a] = v;
      }
      for (const a of alerts) {
        const cur = price[a.mint];
        if (cur == null) continue;
        if (a.kind === "above" && cur >= a.target) triggered.push(a.id);
        if (a.kind === "below" && cur <= a.target) triggered.push(a.id);
      }
    }
    return NextResponse.json({ triggered });
  } catch (e: any) {
    return NextResponse.json({ triggered: [], error: sanitizeError(e) });
  }
}
