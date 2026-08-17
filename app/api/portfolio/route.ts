import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

// Real on-chain portfolio: SPL token balances priced live via DexScreener.
// Powers both Holdings (your wallet) and Wallet Tracker (any wallet).
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// getTokenAccountsByOwner is blocked on some free RPCs (e.g. PublicNode); the official
// endpoint supports it. Override with a paid RPC via MAINNET_RPC.
function rpcFor() {
  return process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
}

/**
 * Backups for the SOL balance only.
 *
 * getBalance is the one call every public RPC answers, and it is the number this whole screen
 * is built around — so it gets failover that the token-account call does not. api.mainnet-beta
 * rate-limits datacenter traffic hard, and when it refused, `sol` fell through to 0 and a user
 * holding 4 SOL was shown 0.000. A second opinion costs one request and removes that.
 */
const BALANCE_FALLBACKS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

async function balanceWithFailover(primary: string, address: string): Promise<number | null> {
  const seen = new Set<string>();
  for (const url of [primary, ...BALANCE_FALLBACKS]) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await rpc(url, "getBalance", [address], 5_000);
      const value = res?.result?.value;
      if (value != null && Number.isFinite(Number(value))) return Number(value);
    } catch { /* try the next provider */ }
  }
  return null;
}

async function rpc(url: string, method: string, params: any[], timeoutMs = 8_000) {
  const r = await fetchWithTimeout(url, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }, timeoutMs);
  if (!r.ok) throw new Error(`Solana RPC returned ${r.status}`);
  return r.json();
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!isMint(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const url = rpcFor();

  try {
    const [balResult, accResult] = await Promise.allSettled([
      balanceWithFailover(url, address),
      rpc(url, "getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }])
    ]);

    const lamports = balResult.status === "fulfilled" ? balResult.value : null;
    const accRes = accResult.status === "fulfilled" ? accResult.value : null;
    const partial = lamports == null || accResult.status === "rejected";
    /**
     * null, NOT 0, when no provider would answer.
     *
     * This used to be `?? 0`, so a refused getBalance reported a confident zero balance for a
     * funded wallet — the screen said 0.000 SOL while the money was there. An unknown balance
     * is now unknown all the way to the interface, which renders it as an absent value. A
     * wrong zero on a money screen is worse than a dash: one is a gap, the other is a claim.
     */
    const sol = lamports == null ? null : lamports / 1e9;
    const accounts: any[] = accRes?.result?.value ?? [];
    const holdings = accounts
      .map((a) => {
        const info = a.account?.data?.parsed?.info;
        const amt = info?.tokenAmount;
        return { mint: info?.mint as string, amount: amt?.uiAmount ?? 0, decimals: amt?.decimals ?? 0 };
      })
      .filter((h) => h.mint && h.amount > 0);

    // price SOL + top holdings via DexScreener (batch, max 30 addresses)
    const mints = [SOL_MINT, ...holdings.map((h) => h.mint)].slice(0, 30);
    const ds = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`, { cache: "no-store" }, 6_000)
      .then((r) => r.json()).catch(() => null);
    const price = new Map<string, any>();
    for (const p of ds?.pairs ?? []) {
      const ad = p.baseToken?.address; if (!ad) continue;
      const cur = price.get(ad);
      const liq = p.liquidity?.usd || 0;
      if (!cur || liq > cur.liq) price.set(ad, {
        priceUsd: Number(p.priceUsd) || null, symbol: p.baseToken?.symbol ?? null,
        name: p.baseToken?.name ?? null, image: p.info?.imageUrl ?? null,
        change24h: p.priceChange?.h24 ?? null, liq
      });
    }

    const solMarket = price.get(SOL_MINT);
    const solPrice = solMarket?.priceUsd ?? 0;
    const solChange24h = solMarket?.change24h ?? null;
    const positions = holdings
      .map((h) => {
        const p = price.get(h.mint);
        const priceUsd = p?.priceUsd ?? null;
        const valueUsd = priceUsd != null ? priceUsd * h.amount : null;
        return {
          mint: h.mint, amount: h.amount, symbol: p?.symbol ?? null, name: p?.name ?? null,
          image: p?.image ?? null, priceUsd, valueUsd, change24h: p?.change24h ?? null, liquidityUsd: p?.liq ?? null
        };
      })
      .filter((p) => (p.valueUsd ?? 0) > 0.01) // hide dust / unpriced spam
      .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

    const tokenUsd = positions.reduce((s, p) => s + (p.valueUsd || 0), 0);
    // An unknown SOL balance makes the total unknown too. Reporting the token value alone as
    // "total" would understate the account by however much SOL it holds.
    const solUsd = sol == null ? null : sol * solPrice;
    return NextResponse.json({
      address, sol, solPrice, solChange24h, solUsd, positions, tokenUsd,
      totalUsd: solUsd == null ? null : solUsd + tokenUsd, count: positions.length, partial,
      warning: sol == null
        ? "The SOL balance could not be read from any Solana RPC. Shown values exclude it."
        : partial
          ? "Some balances could not be read before the Solana RPC timeout."
          : null
    }, {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=60, stale-while-revalidate=300",
        "CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "Vercel-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300"
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
