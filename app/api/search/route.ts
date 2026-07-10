import { NextRequest, NextResponse } from "next/server";
import { rateLimit, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";
// GET /api/search?q= -> matching Solana tokens
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const q = (req.nextUrl.searchParams.get("q") || "").slice(0, 40);
  if (q.length < 2) return NextResponse.json({ results: [] });
  try {
    const d = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { cache: "no-store" }).then(r => r.json());
    const seen = new Set<string>(); const results: any[] = [];
    for (const p of d?.pairs ?? []) {
      if (p.chainId !== "solana") continue;
      const a = p.baseToken?.address; if (!a || seen.has(a)) continue; seen.add(a);
      results.push({ address: a, symbol: p.baseToken?.symbol ?? null, name: p.baseToken?.name ?? null, priceUsd: p.priceUsd, mc: p.marketCap ?? p.fdv ?? null, image: p.info?.imageUrl ?? null });
      if (results.length >= 12) break;
    }
    return NextResponse.json({ results });
  } catch (e: any) { return NextResponse.json({ results: [], error: sanitizeError(e) }, { status: 502 }); }
}
