import { NextRequest, NextResponse } from "next/server";
import { isMint, rateLimit } from "@/lib/server/guard";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const strictNumeric = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/**
 * Copy filters are the client's own preferences and every one of them is optional.
 * Absent or blank means "no filter" — take every call this source makes. A value that
 * IS supplied has to be in range; we never silently coerce a bad number into a limit
 * that would quietly stop someone's trades.
 */
const OPTIONAL_FILTERS = {
  min_liquidity_usd: [0, 100_000_000],
  max_mcap_usd: [0, 1_000_000_000_000],
  cooldown_seconds: [0, 86_400],
  max_open_positions: [1, 500],
  max_calls_per_day: [1, 1000]
} as const;

function readFilters(body: any) {
  const filters: Record<string, number | boolean | null> = {};
  for (const [key, [min, max]] of Object.entries(OPTIONAL_FILTERS)) {
    const raw = body?.[key];
    if (raw === undefined) continue;
    if (raw === null || raw === "") { filters[key] = key === "cooldown_seconds" ? 0 : null; continue; }
    const value = strictNumeric(raw, min, max);
    if (value === null) return { ok: false as const, key };
    filters[key] = key === "min_liquidity_usd" || key === "max_mcap_usd" ? value : Math.round(value);
  }
  if (body?.skip_duplicate_mints !== undefined) {
    filters.skip_duplicate_mints = body.skip_duplicate_mints !== false;
  }
  return { ok: true as const, filters };
}

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
  const enabled = body?.enabled !== false;
  const walletId = typeof body?.wallet_id === "string" ? body.wallet_id.slice(0, 160) : "";
  const userPubkey = typeof body?.user_pubkey === "string" ? body.user_pubkey : "";
  if (enabled && !isMint(userPubkey)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  if (enabled && !walletId) {
    return NextResponse.json({ error: "enable 24/7 auto-trading before copying call groups" }, { status: 400 });
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
  const slippageBps = strictNumeric(body?.slippage_bps, 1, 2000);
  if (!size || !dailyCap || !tp1 || !tp2 || tp1Sell == null || tp2Sell == null || !stopLoss || !slippageBps || tp2 < tp1 || tp1Sell + tp2Sell > 100 || dailyCap < size) {
    return NextResponse.json({ error: "invalid call-copy settings" }, { status: 400 });
  }

  const filters = readFilters(body);
  if (!filters.ok) {
    return NextResponse.json({ error: `invalid ${filters.key.replace(/_/g, " ")}` }, { status: 400 });
  }

  const payload = {
    ...filters.filters,
    privy_user_id: user.privyUserId,
    group_id: groupId,
    size_sol: size,
    tp1,
    tp1_sell: Math.round(tp1Sell),
    tp2,
    tp2_sell: Math.round(tp2Sell),
    stop_loss: Math.round(stopLoss),
    slippage_bps: Math.round(slippageBps),
    daily_cap_sol: dailyCap,
    enabled,
    user_pubkey: userPubkey || null,
    wallet_id: walletId || null
  };

  const result = await callPrivyRpc("app_user_upsert_subscription", {
    p_privy_user_id: user.privyUserId,
    p_group_id: groupId,
    p_payload: payload
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, subscription: result.data });
}
