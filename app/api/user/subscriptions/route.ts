import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const numeric = (v: unknown, fallback: number, min = 0, max = 10_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const result = await callPrivyRpc<any[]>("app_user_list_subscriptions", { p_privy_user_id: user.privyUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ subscriptions: Array.isArray(result.data) ? result.data : [] });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const body = await req.json().catch(() => null);
  const groupId = typeof body?.group_id === "string" ? body.group_id : "";
  if (!isUuid(groupId)) return NextResponse.json({ error: "invalid group" }, { status: 400 });

  const payload = {
    privy_user_id: user.privyUserId,
    group_id: groupId,
    size_sol: numeric(body?.size_sol, 0.5, 0.001, 100),
    tp1: numeric(body?.tp1, 2, 0.1, 1000),
    tp1_sell: Math.round(numeric(body?.tp1_sell, 50, 1, 100)),
    tp2: numeric(body?.tp2, 5, 0.1, 1000),
    tp2_sell: Math.round(numeric(body?.tp2_sell, 25, 1, 100)),
    stop_loss: Math.round(numeric(body?.stop_loss, 40, 1, 100)),
    slippage_bps: Math.round(numeric(body?.slippage_bps, 300, 1, 2000)),
    daily_cap_sol: numeric(body?.daily_cap_sol, 2, 0.001, 1000),
    enabled: body?.enabled !== false,
    user_pubkey: typeof body?.user_pubkey === "string" ? body.user_pubkey.slice(0, 80) : null,
    wallet_id: typeof body?.wallet_id === "string" ? body.wallet_id.slice(0, 160) : null
  };

  const result = await callPrivyRpc("app_user_upsert_subscription", {
    p_privy_user_id: user.privyUserId,
    p_group_id: groupId,
    p_payload: payload
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, subscription: result.data });
}
