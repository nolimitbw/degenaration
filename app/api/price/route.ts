import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const mint = req.nextUrl.searchParams.get("mint");
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  try {
    const targets = mint === SOL_MINT ? SOL_MINT : `${SOL_MINT},${mint}`;
    const r = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${targets}`, { cache: "no-store" });
    const j = await r.json();

    let solPrice = 0;
    for (const p of j?.pairs ?? []) {
      if (p.baseToken?.address === SOL_MINT) solPrice = Number(p.priceUsd) || 0;
    }

    const pairs = (j?.pairs ?? []).filter((p: any) => p.baseToken?.address !== SOL_MINT);
    const pair = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (!pair) return NextResponse.json({ mint, priceUsd: null, solPrice, liquidityUsd: 0, found: false });
    const h24 = pair.txns?.h24 ?? {};
    return NextResponse.json({
      mint, priceUsd: Number(pair.priceUsd) || null, solPrice, liquidityUsd: pair.liquidity?.usd ?? 0,
      dex: pair.dexId, symbol: pair.baseToken?.symbol ?? null, name: pair.baseToken?.name ?? null,
      pairAddress: pair.pairAddress ?? null, chainId: pair.chainId ?? "solana",
      fdv: pair.fdv ?? pair.marketCap ?? null, volume24h: pair.volume?.h24 ?? null,
      change24h: pair.priceChange?.h24 ?? null, buys24h: h24.buys ?? null, sells24h: h24.sells ?? null,
      ageMs: pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : null,
      image: pair.info?.imageUrl ?? null,
      socials: (pair.info?.socials ?? []).map((x: any) => ({ type: x.type, url: x.url })),
      websites: (pair.info?.websites ?? []).map((x: any) => x.url),
      found: true
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
