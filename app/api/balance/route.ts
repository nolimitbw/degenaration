import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";
import { lamportsToSolString } from "@/lib/fee-model";

// GET /api/balance?address=<pubkey> -> SOL balance (lamports + SOL)
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!isMint(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  const rpc = process.env.MAINNET_RPC || "https://solana-rpc.publicnode.com";
  try {
    const r = await fetchWithTimeout(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] })
    }).then((x) => x.json());
    const lamports = r?.result?.value ?? 0;
    // `lamports` is the authoritative integer value. `sol` is a display convenience and
    // must never be fed back into ledger or validation math (spec §13.1).
    return NextResponse.json({ address, lamports, sol: Number(lamportsToSolString(lamports)) });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
