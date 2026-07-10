import { NextRequest, NextResponse } from "next/server";
import { rateLimit, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

/**
 * GET /api/tokens?mode=trending|new
 *
 * Primary source: DexScreener (profiles + batch pair data).
 * Supplemental source: GeckoTerminal pools (adds tokens DexScreener profiles miss).
 * DexScreener data (price, volume, liquidity, dex) is preferred for accuracy.
 */
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const mode = req.nextUrl.searchParams.get("mode") === "new" ? "new" : "trending";
  const now = Date.now();

  try {
    // 1. DexScreener token profiles — latest (new) or boosts (trending).
    //    Includes Pump Fun tokens that GeckoTerminal may not index.
    const dsUrl = mode === "new"
      ? "https://api.dexscreener.com/token-profiles/latest/v1"
      : "https://api.dexscreener.com/token-boosts/latest/v1";
    const dsProfiles = await fetchWithTimeout(dsUrl, { cache: "no-store" })
      .then((r) => r.json()).catch(() => []);
    const profileMap = new Map<string, { image: string | null; socials: any[] }>();
    for (const p of (dsProfiles || [])) {
      if (p.chainId !== "solana" || !p.tokenAddress) continue;
      profileMap.set(p.tokenAddress, {
        image: p.icon || null,
        socials: (p.links || []).map((l: any) => ({ type: l.type || "website", url: l.url })),
      });
    }

    // 2. GeckoTerminal pools — supplemental coverage for traditional AMM tokens.
    const gtMode = mode === "new" ? "new_pools" : "trending_pools";
    const gt = await fetchWithTimeout(`${GT}/${gtMode}?page=1&include=base_token`, { cache: "no-store", headers: { accept: "application/json" } }).then((r) => r.json());
    const pools: any[] = gt?.data ?? [];

    // GeckoTerminal sideloads token images/banners — index by raw "solana_<address>".
    const gtTokens = new Map<string, { image: string | null; banner: string | null }>();
    for (const inc of gt?.included ?? []) {
      if (inc?.type !== "token") continue;
      gtTokens.set(inc.id, { image: inc.attributes?.image_url ?? null, banner: inc.attributes?.banner_image_url ?? null });
    }

    const base = pools.map((p) => {
      const a = p.attributes ?? {};
      const rel = p.relationships?.base_token?.data?.id ?? "";
      const address = rel.replace(/^solana_/, "");
      const symbol = (a.name || "").split("/")[0].trim();
      const vol = a.volume_usd ?? {}; const chg = a.price_change_percentage ?? {};
      const tx = (a.transactions ?? {}).h1 ?? (a.transactions ?? {}).h24 ?? {};
      const created = typeof a.pool_created_at === "string" ? new Date(a.pool_created_at).getTime() || null : null;
      const gtImg = gtTokens.get(rel);
      const prof = profileMap.get(address);
      return {
        address, symbol, name: symbol,
        priceUsd: a.base_token_price_usd ? Number(Number(a.base_token_price_usd).toPrecision(6)) : null,
        marketCap: a.market_cap_usd ? Number(a.market_cap_usd) : (a.fdv_usd ? Number(a.fdv_usd) : null),
        liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
        vol24h: vol.h24 != null ? Number(vol.h24) : null, vol1h: vol.h1 != null ? Number(vol.h1) : null, vol5m: vol.m5 != null ? Number(vol.m5) : null,
        change24h: chg.h24 != null ? Number(chg.h24) : null, change1h: chg.h1 != null ? Number(chg.h1) : null, change5m: chg.m5 != null ? Number(chg.m5) : null,
        buys1h: tx.buys ?? 0, sells1h: tx.sells ?? 0,
        ageMs: created ? now - created : null,
        image: prof?.image ?? gtImg?.image ?? null,
        bannerImage: gtImg?.banner ?? null,
        socials: prof?.socials ?? [],
        dex: null as string | null, risks: [] as string[]
      };
    }).filter((t) => t.address);

    // 3. Add tokens from DexScreener profiles not already in the GeckoTerminal list.
    const seen = new Set(base.map((t) => t.address));
    for (const [addr, prof] of profileMap) {
      if (!seen.has(addr)) {
        base.push({
          address: addr, symbol: "", name: "",
          priceUsd: null, marketCap: null, liquidityUsd: null,
          vol24h: null, vol1h: null, vol5m: null,
          change24h: null, change1h: null, change5m: null,
          buys1h: 0, sells1h: 0,
          ageMs: null,
          image: prof.image, bannerImage: null,
          socials: prof.socials,
          dex: null, risks: [],
        });
        seen.add(addr);
      }
    }

    // 4. Batch-enrich from DexScreener pair data — price, volume, liquidity, dex, images.
    //    Split into chunks of 30 to stay within URL length limits.
    const enrichMap = new Map<string, any>();
    const addrs = base.map((t) => t.address);
    for (let i = 0; i < addrs.length; i += 30) {
      const chunk = addrs.slice(i, i + 30);
      const ds = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`, { cache: "no-store" })
        .then((r) => r.json()).catch(() => null);
      for (const p of ds?.pairs ?? []) {
        const ad = p.baseToken?.address; if (!ad) continue;
        const cur = enrichMap.get(ad);
        const liq = p.liquidity?.usd || 0;
        if (!cur || liq > cur.liq) {
          enrichMap.set(ad, {
            priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
            marketCap: p.marketCap || p.fdv || null,
            liquidityUsd: liq || null,
            vol24h: p.volume?.h24 || null,
            change24h: p.priceChange?.h24 || null,
            buys24h: p.txns?.h24?.buys || null, sells24h: p.txns?.h24?.sells || null,
            ageMs: p.pairCreatedAt ? Date.now() - p.pairCreatedAt : null,
            symbol: p.baseToken?.symbol || null,
            name: p.baseToken?.name || null,
            image: p.info?.imageUrl ?? null,
            socials: (p.info?.socials ?? []).map((x: any) => ({ type: x.type, url: x.url })),
            dex: p.dexId,
            liq,
          });
        }
      }
    }

    for (const t of base) {
      const e = enrichMap.get(t.address);
      if (e) {
        t.priceUsd = e.priceUsd ?? t.priceUsd;
        t.marketCap = e.marketCap ?? t.marketCap;
        t.liquidityUsd = e.liquidityUsd ?? t.liquidityUsd;
        t.vol24h = e.vol24h ?? t.vol24h;
        t.change24h = e.change24h ?? t.change24h;
        t.buys1h = e.buys24h ?? t.buys1h;
        t.sells1h = e.sells24h ?? t.sells1h;
        t.ageMs = e.ageMs ?? t.ageMs;
        t.image = e.image ?? t.image;
        if (e.socials.length) t.socials = e.socials;
        t.dex = e.dex ?? t.dex;
        if (e.symbol) t.symbol = e.symbol;
        if (e.name) t.name = e.name;
      }
      if (!t.liquidityUsd || t.liquidityUsd < 5000) t.risks.push("Low liquidity");
      if ((t.ageMs ?? 1e12) < 3600_000) t.risks.push("Brand new");
    }

    const totalVol = base.reduce((s, t) => s + (t.vol24h || 0), 0);
    return NextResponse.json({ tokens: base, stats: { count: base.length, totalVol }, source: "dexscreener+geckoterminal" });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e), tokens: [] }, { status: 502 });
  }
}
