import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

// GET /api/token-balance?owner=<pubkey>&mint=<mint>&net= -> raw + ui token balance for one mint.
// Read-only RPC call; used by the Sell flow to compute an exact raw amount (no decimal guessing).
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const owner = req.nextUrl.searchParams.get("owner");
  const mint = req.nextUrl.searchParams.get("mint");
  if (!isMint(owner) || !isMint(mint)) return NextResponse.json({ error: "invalid owner/mint" }, { status: 400 });
  const net = req.nextUrl.searchParams.get("net");
  const rpc = net === "devnet"
    ? "https://api.devnet.solana.com"
    : (process.env.MAINNET_RPC || "https://solana-rpc.publicnode.com");
  try {
    const r = await fetchWithTimeout(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }]
      })
    }).then((x) => x.json());
    const accts = r?.result?.value ?? [];
    let raw = BigInt(0);
    let decimals = 0;
    for (const a of accts) {
      const ta = a?.account?.data?.parsed?.info?.tokenAmount;
      if (!ta) continue;
      raw += BigInt(ta.amount || "0");
      decimals = ta.decimals ?? decimals;
    }
    const uiAmount = decimals > 0 ? Number(raw) / 10 ** decimals : Number(raw);
    return NextResponse.json({ owner, mint, rawAmount: raw.toString(), decimals, uiAmount });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
