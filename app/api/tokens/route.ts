import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";

/**
 * GET /api/tokens?mode=trending|new
 * REAL trending/new Solana tokens from GeckoTerminal (by volume, no key), enriched with
 * token images + buys/sells from DexScreener. This matches what you see as "trending".
 */
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const mode = req.nextUrl.searchParams.get("mode") === "new" ? "new_pools" : "trending_pools";

  try {
    const gt = await fetch(`${GT}/${mode}?page=1`, { cache: "no-store", headers: { accept: "application/json" } }).then((r) => r.json());
    const pools: any[] = gt?.data ?? [];
    const now = Date.now();

    const base = pools.map((p) => {
      const a = p.attributes ?? {};
      const rel = p.relationships?.base_token?.data?.id ?? "";
      const address = rel.replace(/^solana_/, "");
      const symbol = (a.name || "").split("/")[0].trim();
      const vol = a.volume_usd ?? {}; const chg = a.price_change_percentage ?? {};
      const tx = (a.transactions ?? {}).h1 ?? (a.transactions ?? {}).h24 ?? {};
      const created = a.pool_created_at ? new Date(a.pool_created_at).getTime() : null;
      return {
        address, symbol, name: symbol,
        priceUsd: a.base_token_price_usd ? Number(Number(a.base_token_price_usd).toPrecision(6)) : null,
        marketCap: a.market_cap_usd ? Number(a.market_cap_usd) : (a.fdv_usd ? Number(a.fdv_usd) : null),
        liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
        vol24h: vol.h24 != null ? Number(vol.h24) : null, vol1h: vol.h1 != null ? Number(vol.h1) : null, vol5m: vol.m5 != null ? Number(vol.m5) : null,
        change24h: chg.h24 != null ? Number(chg.h24) : null, change1h: chg.h1 != null ? Number(chg.h1) : null, change5m: chg.m5 != null ? Number(chg.m5) : null,
        buys1h: tx.buys ?? 0, sells1h: tx.sells ?? 0,
        ageMs: created ? now - created : null,
        image: null as string | null, socials: [] as any[], dex: null as string | null, risks: [] as string[]
      };
    }).filter((t) => t.address);

    // enrich images + socials from DexScreener (batch)
    const addrs = base.map((t) => t.address).slice(0, 30);
    if (addrs.length) {
      const ds = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addrs.join(",")}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      const info = new Map<string, any>();
      for (const p of ds?.pairs ?? []) {
        const ad = p.baseToken?.address; if (!ad) continue;
        const cur = info.get(ad);
        if (!cur || (p.liquidity?.usd || 0) > (cur.liq || 0)) info.set(ad, { image: p.info?.imageUrl ?? null, socials: (p.info?.socials ?? []).map((x: any) => ({ type: x.type, url: x.url })), dex: p.dexId, liq: p.liquidity?.usd || 0 });
      }
      for (const t of base) { const i = info.get(t.address); if (i) { t.image = i.image; t.socials = i.socials; t.dex = i.dex; } if ((t.liquidityUsd || 0) < 5000) t.risks.push("Low liquidity"); if ((t.ageMs ?? 1e12) < 3600_000) t.risks.push("Brand new"); }
    }

    const totalVol = base.reduce((s, t) => s + (t.vol24h || 0), 0);
    return NextResponse.json({ tokens: base, stats: { count: base.length, totalVol }, source: "geckoterminal" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, tokens: [] }, { status: 502 });
  }
}
