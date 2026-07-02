import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint } from "@/lib/server/guard";

/**
 * GET /api/ohlcv?mint=<mint>&tf=minute|hour|day
 * Real candlestick data from GeckoTerminal (free): finds the token's top pool,
 * returns [{ t, o, h, l, c, v }] candles.
 */
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;
  const mint = req.nextUrl.searchParams.get("mint");
  const tf = ["minute", "hour", "day"].includes(req.nextUrl.searchParams.get("tf") || "") ? req.nextUrl.searchParams.get("tf")! : "hour";
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });

  try {
    const pools = await fetch(`${GT}/tokens/${mint}/pools?page=1`, { cache: "no-store" }).then((r) => r.json());
    const pool = pools?.data?.[0]?.attributes?.address;
    if (!pool) return NextResponse.json({ candles: [], pool: null });

    const oh = await fetch(`${GT}/pools/${pool}/ohlcv/${tf}?limit=100`, { cache: "no-store" }).then((r) => r.json());
    const list: number[][] = oh?.data?.attributes?.ohlcv_list ?? [];
    const candles = list
      .map((x) => ({ t: x[0] * 1000, o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] }))
      .sort((a, b) => a.t - b.t);
    return NextResponse.json({ candles, pool });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, candles: [] }, { status: 502 });
  }
}
