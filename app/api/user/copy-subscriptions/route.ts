import { NextRequest, NextResponse } from "next/server";
import { isMint, rateLimit, validSlippageBps } from "@/lib/server/guard";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";

const strictNumeric = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const result = await callPrivyRpc<any[]>("app_user_list_copy_subscriptions", { p_privy_user_id: user.privyUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ subscriptions: Array.isArray(result.data) ? result.data : [] });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const body = await req.json().catch(() => null);
  const leader = body?.leader_wallet;
  const userPubkey = body?.user_pubkey;
  if (!isMint(leader) || !isMint(userPubkey)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const enabled = body?.enabled !== false;
  const walletId = typeof body?.wallet_id === "string" ? body.wallet_id.slice(0, 160) : "";
  if (enabled && !walletId) {
    return NextResponse.json({ error: "enable 24/7 auto-trading before copying wallets" }, { status: 400 });
  }
  if (enabled) {
    const ownership = await requirePrivyWallet(req, user.privyUserId, userPubkey, walletId);
    if (!ownership.ok) return ownership.response;
  }
  const size = strictNumeric(body?.size_sol, 0.001, 100);
  const dailyCap = strictNumeric(body?.daily_cap_sol, 0.001, 1000);
  const tp1 = strictNumeric(body?.tp1, 1.01, 1000);
  const tp2 = strictNumeric(body?.tp2, 1.01, 1000);
  const tp1Sell = strictNumeric(body?.tp1_sell, 1, 100);
  const tp2Sell = strictNumeric(body?.tp2_sell, 0, 100);
  const stopLoss = strictNumeric(body?.stop_loss, 1, 100);
  if (!size || !dailyCap || !tp1 || !tp2 || tp1Sell == null || tp2Sell == null || !stopLoss || tp2 < tp1 || tp1Sell + tp2Sell > 100 || dailyCap < size) {
    return NextResponse.json({ error: "invalid copy settings" }, { status: 400 });
  }
  const payload = {
    privy_user_id: user.privyUserId,
    leader_wallet: leader,
    label: typeof body?.label === "string" ? body.label.slice(0, 80) : null,
    size_sol: size,
    slippage_bps: validSlippageBps(body?.slippage_bps),
    daily_cap_sol: dailyCap,
    tp1,
    tp1_sell: Math.round(tp1Sell),
    tp2,
    tp2_sell: Math.round(tp2Sell),
    stop_loss: Math.round(stopLoss),
    enabled,
    user_pubkey: userPubkey,
    wallet_id: walletId || null
  };
  const result = await callPrivyRpc("app_user_upsert_copy_subscription", { p_privy_user_id: user.privyUserId, p_payload: payload });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, subscription: result.data });
}

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const leader = req.nextUrl.searchParams.get("leader_wallet") || "";
  if (!isMint(leader)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const result = await callPrivyRpc("app_user_delete_copy_subscription", { p_privy_user_id: user.privyUserId, p_leader_wallet: leader });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
