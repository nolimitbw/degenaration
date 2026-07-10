import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { rateLimit, isMint, sanitizeError } from "@/lib/server/guard";

const toNum = (v: any): number | null => v != null ? Number(v) : null;

/**
 * POST /api/record-trade — records an executed swap (for portfolio, history, commissions).
 * Auth: Supabase bearer token. Fee is the 2% platform fee taken on-chain.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const authz = req.headers.get("authorization") || "";
  const token = authz.replace(/^Bearer\s+/, "");
  if (!token) return NextResponse.json({ error: "auth required" }, { status: 401 });

  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!isMint(b?.mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const supa = createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const { error } = await supa.from("trades").insert({
    user_id: auth.user.id, mint: b.mint, side: b.side === "sell" ? "sell" : "buy",
    sol_amount: toNum(b.solAmount), token_amount: toNum(b.tokenAmount),
    price_usd: toNum(b.priceUsd), fee_sol: toNum(b.feeSol),
    tx_signature: b.sig || null, kind: b.kind || "manual"
  });
  if (error) return NextResponse.json({ error: sanitizeError(error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
