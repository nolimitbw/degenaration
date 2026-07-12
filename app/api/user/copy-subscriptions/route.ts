import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, isMint, rateLimit, validSlippageBps } from "@/lib/server/guard";
import { requirePrivyUser, serviceHeaders, serviceUrl } from "@/lib/server/privy";

const numeric = (v: unknown, fallback: number, min = 0, max = 10_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

async function existingCopy(privyUserId: string, leader: string) {
  const SB = serviceUrl();
  const headers = serviceHeaders();
  if (!SB || !headers) return null;
  const rows = await fetchWithTimeout(`${SB}/rest/v1/copy_subscriptions?privy_user_id=eq.${encodeURIComponent(privyUserId)}&leader_wallet=eq.${encodeURIComponent(leader)}&select=id&limit=1`, { headers })
    .then((r) => r.json()).catch(() => []);
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
  const rows = await fetchWithTimeout(`${SB}/rest/v1/copy_subscriptions?privy_user_id=eq.${encodeURIComponent(user.privyUserId)}&select=id,leader_wallet,label,size_sol,slippage_bps,daily_cap_sol,enabled,tp1,tp1_sell,tp2,tp2_sell,stop_loss`, { headers })
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
  const leader = body?.leader_wallet;
  const userPubkey = body?.user_pubkey;
  if (!isMint(leader) || !isMint(userPubkey)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const payload = {
    privy_user_id: user.privyUserId,
    leader_wallet: leader,
    label: typeof body?.label === "string" ? body.label.slice(0, 80) : null,
    size_sol: numeric(body?.size_sol, 0.1, 0.001, 100),
    slippage_bps: validSlippageBps(body?.slippage_bps),
    daily_cap_sol: numeric(body?.daily_cap_sol, 2, 0.001, 1000),
    tp1: numeric(body?.tp1, 2, 0.1, 1000),
    tp1_sell: Math.round(numeric(body?.tp1_sell, 50, 1, 100)),
    tp2: numeric(body?.tp2, 5, 0.1, 1000),
    tp2_sell: Math.round(numeric(body?.tp2_sell, 25, 1, 100)),
    stop_loss: Math.round(numeric(body?.stop_loss, 40, 1, 100)),
    enabled: true,
    user_pubkey: userPubkey,
    wallet_id: typeof body?.wallet_id === "string" ? body.wallet_id.slice(0, 160) : null
  };
  const id = await existingCopy(user.privyUserId, leader);
  const response = await fetchWithTimeout(id ? `${SB}/rest/v1/copy_subscriptions?id=eq.${encodeURIComponent(id)}` : `${SB}/rest/v1/copy_subscriptions`, {
    method: id ? "PATCH" : "POST", headers, body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: data?.message || "could not save copy subscription" }, { status: 400 });
  return NextResponse.json({ ok: true, subscription: Array.isArray(data) ? data[0] : data });
}

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const SB = serviceUrl();
  const headers = serviceHeaders({ prefer: "return=minimal" });
  if (!SB || !headers) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const leader = req.nextUrl.searchParams.get("leader_wallet") || "";
  if (!isMint(leader)) return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  const response = await fetchWithTimeout(`${SB}/rest/v1/copy_subscriptions?privy_user_id=eq.${encodeURIComponent(user.privyUserId)}&leader_wallet=eq.${encodeURIComponent(leader)}`, {
    method: "DELETE", headers
  });
  if (!response.ok) return NextResponse.json({ error: "could not stop copy" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
