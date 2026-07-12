import { NextRequest, NextResponse } from "next/server";
import { isMint, rateLimit, validSlippageBps } from "@/lib/server/guard";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

const num = (v: unknown, min = 0, max = 10_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n > min && n <= max ? n : null;
};

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const result = await callPrivyRpc<any[]>("app_user_list_limit_orders", { p_privy_user_id: user.privyUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ orders: Array.isArray(result.data) ? result.data : [] });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const body = await req.json().catch(() => null);
  const mint = body?.mint;
  const trigger = body?.trigger === "above" ? "above" : "below";
  const target = num(body?.target_usd, 0, 1_000_000_000);
  const amount = num(body?.amount_sol, 0, 100);
  const userPubkey = body?.user_pubkey;
  const walletId = typeof body?.wallet_id === "string" ? body.wallet_id.slice(0, 160) : "";
  if (!isMint(mint) || !target || !amount || !isMint(userPubkey)) {
    return NextResponse.json({ error: "invalid order" }, { status: 400 });
  }
  if (!walletId) {
    return NextResponse.json({ error: "enable 24/7 auto-trading before creating limit orders" }, { status: 400 });
  }

  const payload = {
    privy_user_id: user.privyUserId,
    mint,
    symbol: typeof body?.symbol === "string" ? body.symbol.slice(0, 24) : mint.slice(0, 6),
    trigger,
    target_usd: target,
    amount_sol: amount,
    slippage_bps: validSlippageBps(body?.slippage_bps),
    user_pubkey: userPubkey,
    wallet_id: walletId,
    status: "open"
  };
  const result = await callPrivyRpc("app_user_create_limit_order", { p_privy_user_id: user.privyUserId, p_payload: payload });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, order: result.data });
}

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const result = await callPrivyRpc("app_user_update_limit_order", {
    p_privy_user_id: user.privyUserId,
    p_id: id,
    p_action: body?.action === "filled" ? "filled" : "cancelled",
    p_sig: typeof body?.sig === "string" ? body.sig.slice(0, 120) : ""
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
