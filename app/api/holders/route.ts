import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint } from "@/lib/server/guard";

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
      fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenLargestAccounts", params: [mint] }) }).then(r => r.json()),
      fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getTokenSupply", params: [mint] }) }).then(r => r.json())
    ]);
    const total = Number(supply?.result?.value?.uiAmount) || 0;
    const holders = (largest?.result?.value ?? []).slice(0, 20).map((h: any, i: number) => ({
      rank: i + 1, address: h.address,
      amount: Number(h.uiAmount) || 0,
      pct: total ? ((Number(h.uiAmount) || 0) / total) * 100 : null
    }));
    return NextResponse.json({ holders, totalSupply: total });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, holders: [] }, { status: 502 });
  }
}
