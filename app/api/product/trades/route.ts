import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";
import { fetchWithTimeout } from "@/lib/server/guard";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TRUSTED_QUOTES = new Set([SOL_MINT, USDC_MINT]);

type TradeHistory = { asOf?: string; positions?: Array<Record<string, any>> };

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function deepest(rows: any[]) {
  return [...rows].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0];
}

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 30, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const history = await callPrivyRpc<TradeHistory>("app_user_trade_history", {
    p_privy_user_id: user.privyUserId,
    p_limit: 200
  });
  if (!history.ok) return NextResponse.json({ error: history.error }, { status: history.status });

  const positions = Array.isArray(history.data?.positions) ? history.data.positions : [];
  const mints = [...new Set(positions.map((row) => String(row.mint || "")).filter(Boolean))];
  const quoteMints = [...new Set([SOL_MINT, ...mints])];
  const pairs: any[] = [];
  for (const group of chunks(quoteMints, 30)) {
    const payload = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${group.join(",")}`,
      { cache: "no-store" },
      7_000
    ).then((response) => response.json()).catch(() => null);
    if (Array.isArray(payload?.pairs)) pairs.push(...payload.pairs);
  }

  const solPair = deepest(pairs.filter((pair) =>
    pair?.chainId === "solana"
      && pair?.baseToken?.address === SOL_MINT
      && pair?.quoteToken?.address === USDC_MINT
  ));
  const solPriceUsd = Number(solPair?.priceUsd) || null;

  const rpcUrl = process.env.MAINNET_RPC || process.env.NEXT_PUBLIC_MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  const supplyPayload = mints.map((mint, index) => ({
    jsonrpc: "2.0", id: index + 1, method: "getTokenSupply", params: [mint, { commitment: "confirmed" }]
  }));
  const supply = supplyPayload.length
    ? await fetchWithTimeout(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplyPayload),
        cache: "no-store"
      }, 8_000).then((response) => response.json()).catch(() => null)
    : [];
  const decimals = new Map<string, number>();
  if (Array.isArray(supply)) {
    for (const item of supply) {
      const mint = mints[Number(item?.id) - 1];
      const value = Number(item?.result?.value?.decimals);
      if (mint && Number.isInteger(value) && value >= 0 && value <= 18) decimals.set(mint, value);
    }
  }

  const quotes: Record<string, any> = {};
  for (const mint of mints) {
    const pair = deepest(pairs.filter((candidate) =>
      candidate?.chainId === "solana"
        && candidate?.baseToken?.address === mint
        && TRUSTED_QUOTES.has(candidate?.quoteToken?.address)
    ));
    quotes[mint] = pair ? {
      priceUsd: Number(pair.priceUsd) || null,
      symbol: pair.baseToken?.symbol || null,
      name: pair.baseToken?.name || null,
      liquidityUsd: Number(pair.liquidity?.usd) || 0,
      pairAddress: pair.pairAddress || null,
      decimals: decimals.get(mint) ?? null
    } : { priceUsd: null, symbol: null, name: null, liquidityUsd: 0, pairAddress: null, decimals: decimals.get(mint) ?? null };
  }

  return NextResponse.json({
    asOf: history.data?.asOf || new Date().toISOString(),
    solPriceUsd,
    positions,
    quotes
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
