import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, sanitizeError } from "@/lib/server/guard";
import { lamportsToSolString } from "@/lib/fee-model";
import { walletBalanceLamports } from "@/lib/server/wallet-balance";

// GET /api/balance?address=<pubkey> -> SOL balance (lamports + SOL)
export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const address = req.nextUrl.searchParams.get("address");
  if (!isMint(address)) return NextResponse.json({ error: "invalid address" }, { status: 400 });
  try {
    const balance = await walletBalanceLamports(address);
    if (balance == null) return NextResponse.json({ error: "Balance unavailable" }, { status: 502 });
    const lamports = balance.toString();
    // `lamports` is the authoritative integer value. `sol` is a display convenience and
    // must never be fed back into ledger or validation math (spec §13.1).
    return NextResponse.json({ address, lamports, sol: Number(lamportsToSolString(lamports)) });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
