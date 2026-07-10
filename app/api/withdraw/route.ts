import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, validAmount, sanitizeError } from "@/lib/server/guard";

/**
 * POST /api/withdraw
 * body: { from, to, amountSol }
 * Builds an UNSIGNED SOL transfer transaction (base64). The owner signs it with their
 * own wallet (Phantom via window.solana) — the platform never holds keys.
 * Use for withdrawing accumulated 2% commissions from the fee wallet.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const authz = req.headers.get("authorization") || "";
  if (!/^Bearer\s+.+/.test(authz)) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { from, to, amountSol } = body ?? {};
  if (!isMint(from) || !isMint(to)) return NextResponse.json({ error: "invalid address" }, { status: 400 });

  // Owner-only: a withdrawal may only ever be built FROM an allowlisted owner wallet.
  // Even if this endpoint is called directly, it can never spend anyone else's funds,
  // and the resulting tx still has to be signed by that wallet's key holder.
  const allowlist = (process.env.ADMIN_WALLETS || process.env.PLATFORM_FEE_ACCOUNT || process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowlist.length === 0) return NextResponse.json({ error: "withdrawals not configured" }, { status: 403 });
  if (!allowlist.includes(from)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const lamports = validAmount(Math.floor(Number(amountSol) * 1e9));
  if (lamports == null) return NextResponse.json({ error: "invalid amount" }, { status: 400 });

  const rpc = process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  try {
    const web3 = await import("@solana/web3.js");
    const conn = new web3.Connection(rpc);
    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new web3.Transaction({ feePayer: new web3.PublicKey(from), recentBlockhash: blockhash }).add(
      web3.SystemProgram.transfer({
        fromPubkey: new web3.PublicKey(from),
        toPubkey: new web3.PublicKey(to),
        lamports
      })
    );
    const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64");
    return NextResponse.json({ transaction: serialized, lamports });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
