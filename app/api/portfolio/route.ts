import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

// Real on-chain portfolio: SPL token balances priced live via DexScreener.
// Powers both Holdings (your wallet) and Wallet Tracker (any wallet).
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// getTokenAccountsByOwner is blocked on some free RPCs (e.g. PublicNode); the official
// endpoint supports it. Override with a paid RPC via MAINNET_RPC.
function rpcFor(net: string | null) {
  if (net === "devnet") return "https://api.devnet.solana.com";
  return process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
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
  const url = rpcFor(req.nextUrl.searchParams.get("net"));

  try {
    const [balResult, accResult] = await Promise.allSettled([
      rpc(url, "getBalance", [address], 5_000),
      rpc(url, "getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }])
    ]);
    if (balResult.status === "rejected" && accResult.status === "rejected") throw balResult.reason;

    const balRes = balResult.status === "fulfilled" ? balResult.value : null;
    const accRes = accResult.status === "fulfilled" ? accResult.value : null;
    const partial = balResult.status === "rejected" || accResult.status === "rejected";
    const sol = (balRes?.result?.value ?? 0) / 1e9;
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
    const solUsd = sol * solPrice;
    return NextResponse.json({
      address, sol, solPrice, solChange24h, solUsd, positions, tokenUsd,
      totalUsd: solUsd + tokenUsd, count: positions.length, partial,
      warning: partial ? "Some balances could not be read before the Solana RPC timeout." : null
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
