import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { rateLimit, isMint } from "@/lib/server/guard";
import { callAppBridge } from "@/lib/server/app-bridge";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";
import { verifySwapTransaction } from "@/lib/server/trade-verification";

const toNum = (v: any): number | null => v != null ? Number(v) : null;
const kinds = new Set(["manual", "entry", "tp1", "tp2", "sl"]);
type VerifiedTrade = { ok: true; side: "buy" | "sell"; feeSol: number; tokenAmount: number } | { ok: false; error: string };

/**
 * POST /api/record-trade — records an executed swap (for portfolio, history, commissions).
 * Auth: Privy bearer token or legacy Supabase bearer token. Fee is the configured platform fee taken on-chain.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const authz = req.headers.get("authorization") || "";
  const token = authz.replace(/^Bearer\s+/, "");
  if (!token) return NextResponse.json({ error: "auth required" }, { status: 401 });

  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!isMint(b?.mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  if (!isMint(b?.userPubkey)) return NextResponse.json({ error: "invalid user pubkey" }, { status: 400 });
  const side = b.side === "sell" ? "sell" : "buy";

  const privy = await requirePrivyUser(req);
  if (privy.ok) {
    const verified = await verifySwapTransaction({
      rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_MAINNET_RPC || "https://solana-rpc.publicnode.com",
      signature: b.sig,
      userPubkey: b.userPubkey,
      mint: b.mint,
      side,
      feeAccount: process.env.PLATFORM_FEE_ACCOUNT || null
    }) as VerifiedTrade;
    if (!verified.ok) {
      const error = verified.error || "transaction verification failed";
      return NextResponse.json({ error }, { status: error.includes("confirmed") ? 409 : 400 });
    }
    const result = await callPrivyRpc("app_user_insert_trade", {
      p_privy_user_id: privy.privyUserId,
      p_user_pubkey: b.userPubkey,
      p_mint: b.mint,
      p_side: verified.side,
      p_sol_amount: toNum(b.solAmount),
      p_token_amount: verified.tokenAmount,
      p_price_usd: toNum(b.priceUsd),
      p_fee_sol: verified.feeSol,
      p_tx_signature: b.sig || "",
      p_kind: kinds.has(b.kind) ? b.kind : "manual"
    });
    if (!result.ok) {
      if (result.status === 409 && result.error === "transaction already recorded") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const supa = createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "invalid session" }, { status: 401 });

  const verified = await verifySwapTransaction({
    rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_MAINNET_RPC || "https://solana-rpc.publicnode.com",
    signature: b.sig,
    userPubkey: b.userPubkey,
    mint: b.mint,
    side,
    feeAccount: process.env.PLATFORM_FEE_ACCOUNT || null
  }) as VerifiedTrade;
  if (!verified.ok) {
    const error = verified.error || "transaction verification failed";
    return NextResponse.json({ error }, { status: error.includes("confirmed") ? 409 : 400 });
  }

  const result = await callAppBridge("app_supabase_insert_trade", {
    p_user_id: auth.user.id,
    p_user_pubkey: b.userPubkey,
    p_mint: b.mint,
    p_side: verified.side,
    p_sol_amount: toNum(b.solAmount),
    p_token_amount: verified.tokenAmount,
    p_price_usd: toNum(b.priceUsd),
    p_fee_sol: verified.feeSol,
    p_tx_signature: b.sig,
    p_kind: kinds.has(b.kind) ? b.kind : "manual"
  });
  if (!result.ok) {
    if (result.status === 409 && result.error === "transaction already recorded") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
