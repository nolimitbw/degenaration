import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

/**
 * GET /api/wallet?address=<pubkey>
 * Real wallet snapshot from Solana RPC: SOL balance + recent activity (signatures).
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!isMint(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });

  const net = req.nextUrl.searchParams.get("net");
  const rpc = net === "mainnet" ? (process.env.MAINNET_RPC || "https://solana-rpc.publicnode.com") : (net === "devnet" ? "https://api.devnet.solana.com" : (process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com"));
  try {
    const [balRes, sigRes] = await Promise.all([
      fetchWithTimeout(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }) }).then((r) => r.json()),
      fetchWithTimeout(rpc, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getSignaturesForAddress", params: [address, { limit: 20 }] }) }).then((r) => r.json())
    ]);
    const lamports = balRes?.result?.value ?? 0;
    const sigs: any[] = sigRes?.result ?? [];
    const lastTs = sigs[0]?.blockTime ? sigs[0].blockTime * 1000 : null;
    return NextResponse.json({
      address, sol: lamports / 1e9, txCount: sigs.length,
      lastActiveMs: lastTs ? Date.now() - lastTs : null,
      recent: sigs.slice(0, 8).map((s) => ({ sig: s.signature, ts: s.blockTime ? s.blockTime * 1000 : null, err: !!s.err }))
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
