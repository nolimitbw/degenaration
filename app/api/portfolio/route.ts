import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint } from "@/lib/server/guard";

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

async function rpc(url: string, method: string, params: any[]) {
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return r.json();
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!isMint(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const url = rpcFor(req.nextUrl.searchParams.get("net"));

  try {
    const [balRes, accRes] = await Promise.all([
      rpc(url, "getBalance", [address]),
      rpc(url, "getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }])
    ]);

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
    const ds = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`, { cache: "no-store" })
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

    const solPrice = price.get(SOL_MINT)?.priceUsd ?? 0;
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
      address, sol, solPrice, solUsd, positions, tokenUsd,
      totalUsd: solUsd + tokenUsd, count: positions.length
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
