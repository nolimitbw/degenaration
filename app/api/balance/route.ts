import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

// GET /api/balance?address=<pubkey> -> SOL balance (lamports + SOL)
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!isMint(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const net = req.nextUrl.searchParams.get("net");
  const rpc = net === "mainnet" ? (process.env.MAINNET_RPC || "https://solana-rpc.publicnode.com") : (net === "devnet" ? "https://api.devnet.solana.com" : (process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com"));
  try {
    const r = await fetchWithTimeout(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] })
    }).then((x) => x.json());
    const lamports = r?.result?.value ?? 0;
    return NextResponse.json({ address, lamports, sol: lamports / 1e9 });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
