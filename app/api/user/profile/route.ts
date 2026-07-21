import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const result = await callPrivyRpc("app_user_get_profile", { p_privy_user_id: user.privyUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ profile: result.data });
}

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid profile" }, { status: 400 });

  const payload: Record<string, unknown> = {};
  let riskAccepted: boolean | null = null;
  if ("wallet_address" in body) {
    if (typeof body.wallet_address !== "string" || !MINT_RE.test(body.wallet_address)) {
      return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
    }
    payload.wallet_address = body.wallet_address;
  }
  if ("max_trade_sol" in body) {
    const value = Number(body.max_trade_sol);
    if (!Number.isFinite(value) || value <= 0 || value > 100) return NextResponse.json({ error: "invalid max trade" }, { status: 400 });
    payload.max_trade_sol = value;
  }
  if ("daily_cap_sol" in body) {
    const value = Number(body.daily_cap_sol);
    if (!Number.isFinite(value) || value <= 0 || value > 1000) return NextResponse.json({ error: "invalid daily cap" }, { status: 400 });
    payload.daily_cap_sol = value;
  }
  if ("quick_buy_amounts" in body) {
    const values = Array.isArray(body.quick_buy_amounts) ? body.quick_buy_amounts.map(Number) : [];
    if (!values.length || values.length > 4 || values.some((value: number) => !Number.isFinite(value) || value <= 0 || value > 100)) {
      return NextResponse.json({ error: "invalid quick-buy amounts" }, { status: 400 });
    }
    payload.quick_buy_amounts = values;
  }
  if ("risk_accepted" in body) {
    if (typeof body.risk_accepted !== "boolean") return NextResponse.json({ error: "invalid risk acceptance" }, { status: 400 });
    riskAccepted = body.risk_accepted;
  }
  if (!Object.keys(payload).length && riskAccepted == null) return NextResponse.json({ error: "no profile changes" }, { status: 400 });

  if (Object.keys(payload).length) {
    const result = await callPrivyRpc("app_user_upsert_profile", {
      p_privy_user_id: user.privyUserId,
      p_payload: payload
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (riskAccepted != null) {
    const result = await callPrivyRpc("app_user_set_risk_acceptance", {
      p_privy_user_id: user.privyUserId,
      p_accepted: riskAccepted
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
