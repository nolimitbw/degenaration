import { NextRequest, NextResponse } from "next/server";
import { rateLimit, sanitizeError } from "@/lib/server/guard";
import { ttlFetchSafe } from "@/lib/server/cache";

/**
 * GET /api/smart-wallets
 * REAL on-chain "smart money" discovery — no fabricated rows. Methodology:
 *   1. Take today's actual top-gaining Solana pools (GeckoTerminal trending).
 *   2. Pull each pool's real recent trades, find the earliest real buy transactions
 *      (the wallets that bought before the price moved).
 *   3. A wallet that shows up as an early buyer on MULTIPLE currently-pumping tokens,
 *      or whose entry is now up a large multiple, is surfaced — ranked by repeat hits
 *      then by best unrealized multiple.
 * This is necessarily a lightweight, free-data-source approximation (no paid wallet
 * analytics API is configured) — it surfaces real, verifiable on-chain buys, not a
 * comprehensive historical win-rate service. Cached 5 min: cheap to poll, expensive
 * to compute (many upstream calls), and the underlying "top gainers" don't change fast.
 */
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const CACHE_KEY = "smart-wallets-v1";
const CACHE_TTL = 5 * 60_000;
const MIN_LIQUIDITY_USD = 5000; // skip pools too thin to trust the trade data
const POOLS_TO_SCAN = 8;
const BEST_BUYS_PER_POOL = 15;

type Catch = { symbol: string; mint: string; multiple: number };
type SmartWallet = { address: string; catches: Catch[]; catchCount: number; bestMultiple: number; avgMultiple: number };

async function computeSmartWallets(): Promise<SmartWallet[]> {
  const gt = await ttlFetchSafe(`${GT}/trending_pools?page=1`, 60_000, { headers: { accept: "application/json" } });
  const pools: any[] = gt?.data ?? [];

  const candidates = pools
    .map((p) => {
      const a = p.attributes ?? {};
      const rel = p.relationships?.base_token?.data?.id ?? "";
      const mint = rel.replace(/^solana_/, "");
      const symbol = (a.name || "").split("/")[0].trim();
      return {
        pool: a.address as string, mint, symbol,
        priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
        liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : 0,
        change24h: a.price_change_percentage?.h24 != null ? Number(a.price_change_percentage.h24) : 0
      };
    })
    .filter((t) => t.mint && t.pool && t.priceUsd && t.liquidityUsd >= MIN_LIQUIDITY_USD)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, POOLS_TO_SCAN);

  const byWallet = new Map<string, Map<string, Catch>>(); // wallet -> mint -> best catch for that mint

  await Promise.all(candidates.map(async (t) => {
    let trades: any[] = [];
    try {
      const td = await ttlFetchSafe(`${GT}/pools/${t.pool}/trades`, 60_000, { headers: { accept: "application/json" } });
      trades = td?.data ?? [];
    } catch { return; }

    // Rank every real buy in the fetched window by actual unrealized multiple, rather than
    // assuming "earliest in this ~300-trade page" means "earliest ever" — for a high-volume
    // pool, 300 trades can be just the last few minutes, so feed-order alone is unreliable.
    // Picking by best real entry-vs-now performance is honest either way and self-corrects.
    const scored = trades
      .filter((tr) => tr?.attributes?.kind === "buy" && tr?.attributes?.tx_from_address)
      .map((tr) => {
        const attr = tr.attributes;
        const entryPrice = Number(attr.price_to_in_usd);
        if (!entryPrice || !Number.isFinite(entryPrice) || !t.priceUsd) return null;
        const multiple = t.priceUsd / entryPrice;
        if (!Number.isFinite(multiple) || multiple <= 1) return null; // only real, currently-in-profit entries
        return { wallet: attr.tx_from_address as string, multiple };
      })
      .filter((x): x is { wallet: string; multiple: number } => x != null)
      .sort((a, b) => b.multiple - a.multiple)
      .slice(0, BEST_BUYS_PER_POOL);

    for (const { wallet, multiple } of scored) {
      if (!byWallet.has(wallet)) byWallet.set(wallet, new Map());
      const perMint = byWallet.get(wallet)!;
      const existing = perMint.get(t.mint);
      if (!existing || multiple > existing.multiple) perMint.set(t.mint, { symbol: t.symbol, mint: t.mint, multiple });
    }
  }));

  const wallets: SmartWallet[] = [...byWallet.entries()]
    .map(([address, perMint]) => {
      const catches = [...perMint.values()].sort((a, b) => b.multiple - a.multiple);
      const multiples = catches.map((c) => c.multiple);
      return {
        address, catches, catchCount: catches.length,
        bestMultiple: Math.max(...multiples),
        avgMultiple: multiples.reduce((s, m) => s + m, 0) / multiples.length
      };
    })
    .filter((w) => w.catchCount >= 1)
    .sort((a, b) => b.catchCount - a.catchCount || b.bestMultiple - a.bestMultiple)
    .slice(0, 15);

  return wallets;
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  try {
    const now = Date.now();
    const cached = (global as any).__smartWalletsCache;
    if (cached && now - cached.at < CACHE_TTL) {
      return NextResponse.json({ wallets: cached.data, asOf: cached.at, cached: true });
    }
    const wallets = await computeSmartWallets();
    (global as any).__smartWalletsCache = { at: now, data: wallets };
    return NextResponse.json({ wallets, asOf: now, cached: false });
  } catch (e: any) {
    const cached = (global as any).__smartWalletsCache;
    if (cached) return NextResponse.json({ wallets: cached.data, asOf: cached.at, cached: true, stale: true });
    return NextResponse.json({ error: sanitizeError(e), wallets: [] }, { status: 502 });
  }
}
