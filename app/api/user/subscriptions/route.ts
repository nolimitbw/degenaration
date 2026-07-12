import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { requirePrivyUser, serviceHeaders, serviceUrl } from "@/lib/server/privy";

const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const numeric = (v: unknown, fallback: number, min = 0, max = 10_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

async function findExisting(privyUserId: string, groupId: string) {
  const SB = serviceUrl();
  const headers = serviceHeaders();
  if (!SB || !headers) return null;
  const url = `${SB}/rest/v1/subscriptions?privy_user_id=eq.${encodeURIComponent(privyUserId)}&group_id=eq.${encodeURIComponent(groupId)}&select=id&limit=1`;
  const rows = await fetchWithTimeout(url, { headers }).then((r) => r.json()).catch(() => []);
  return Array.isArray(rows) ? rows[0]?.id as string | undefined : undefined;
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const SB = serviceUrl();
  const headers = serviceHeaders();
  if (!SB || !headers) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const rows = await fetchWithTimeout(`${SB}/rest/v1/subscriptions?privy_user_id=eq.${encodeURIComponent(user.privyUserId)}&select=group_id,size_sol,tp1,tp1_sell,tp2,tp2_sell,stop_loss,slippage_bps,daily_cap_sol,enabled`, { headers })
    .then((r) => r.json()).catch(() => []);
  return NextResponse.json({ subscriptions: Array.isArray(rows) ? rows : [] });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const SB = serviceUrl();
  const headers = serviceHeaders({ prefer: "return=representation" });
  if (!SB || !headers) return NextResponse.json({ error: "server not configured" }, { status: 503 });

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

  const existing = await findExisting(user.privyUserId, groupId);
  const url = existing
    ? `${SB}/rest/v1/subscriptions?id=eq.${encodeURIComponent(existing)}`
    : `${SB}/rest/v1/subscriptions`;
  const method = existing ? "PATCH" : "POST";
  const response = await fetchWithTimeout(url, { method, headers, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: data?.message || "could not save subscription" }, { status: 400 });
  return NextResponse.json({ ok: true, subscription: Array.isArray(data) ? data[0] : data });
}
