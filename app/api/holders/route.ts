import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";
import { ttlFetchSafe } from "@/lib/server/cache";

// GET /api/holders?mint= -> top token holders (RPC getTokenLargestAccounts) + supply
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;
  const mint = req.nextUrl.searchParams.get("mint");
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  const net = req.nextUrl.searchParams.get("net");
  const rpc = net === "mainnet" ? (process.env.MAINNET_RPC || "https://solana-rpc.publicnode.com") : (net === "devnet" ? "https://api.devnet.solana.com" : (process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com"));
  try {
    const [largest, supply] = await Promise.all([
      fetchWithTimeout(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint] }) }).then(r => r.json()),
      fetchWithTimeout(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getTokenSupply", params: [mint] }) }).then(r => r.json())
    ]);
    let total = Number(supply?.result?.value?.uiAmount) || 0;
    let holders = (largest?.result?.value ?? []).slice(0, 20).map((h: any, i: number) => ({
      rank: i + 1, address: h.address,
      amount: Number(h.uiAmount) || 0,
      pct: total ? ((Number(h.uiAmount) || 0) / total) * 100 : null
    }));

    // Several free RPCs block getTokenLargestAccounts. RugCheck exposes the same
    // on-chain accounts and percentages, so use it when the RPC cannot return rows.
    if (!holders.length) {
      const report = await ttlFetchSafe(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, 60_000);
      const decimals = Number(report?.token?.decimals) || 0;
      const divisor = 10 ** decimals;
      const reportSupply = Number(report?.token?.supply);
      if (!total && Number.isFinite(reportSupply) && divisor) total = reportSupply / divisor;
      holders = (Array.isArray(report?.topHolders) ? report.topHolders : []).slice(0, 20).map((h: any, i: number) => {
        const amount = Number(h?.uiAmount);
        const pct = Number(h?.pct);
        return {
          rank: i + 1,
          address: typeof h?.address === "string" ? h.address : "",
          amount: Number.isFinite(amount) ? amount : 0,
          pct: Number.isFinite(pct) ? pct : null
        };
      }).filter((h: any) => h.address);
    }

    return NextResponse.json({ holders, totalSupply: total });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e), holders: [] }, { status: 502 });
  }
}
