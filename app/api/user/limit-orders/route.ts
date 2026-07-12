import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, isMint, rateLimit, validSlippageBps } from "@/lib/server/guard";
import { requirePrivyUser, serviceHeaders, serviceUrl } from "@/lib/server/privy";

const num = (v: unknown, min = 0, max = 10_000) => {
  const n = Number(v);
  return Number.isFinite(n) && n > min && n <= max ? n : null;
};

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const SB = serviceUrl();
  const headers = serviceHeaders();
  if (!SB || !headers) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const rows = await fetchWithTimeout(`${SB}/rest/v1/limit_orders?privy_user_id=eq.${encodeURIComponent(user.privyUserId)}&select=id,mint,symbol,trigger,target_usd,amount_sol,slippage_bps,status,created_at,sig&order=created_at.desc`, { headers })
    .then((r) => r.json()).catch(() => []);
  return NextResponse.json({ orders: Array.isArray(rows) ? rows : [] });
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
  const mint = body?.mint;
  const trigger = body?.trigger === "above" ? "above" : "below";
  const target = num(body?.target_usd, 0, 1_000_000_000);
  const amount = num(body?.amount_sol, 0, 100);
  const userPubkey = body?.user_pubkey;
  if (!isMint(mint) || !target || !amount || !isMint(userPubkey)) {
    return NextResponse.json({ error: "invalid order" }, { status: 400 });
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
    wallet_id: typeof body?.wallet_id === "string" ? body.wallet_id.slice(0, 160) : null,
    status: "open"
  };
  const response = await fetchWithTimeout(`${SB}/rest/v1/limit_orders`, { method: "POST", headers, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: data?.message || "could not create order" }, { status: 400 });
  return NextResponse.json({ ok: true, order: Array.isArray(data) ? data[0] : data });
}

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const SB = serviceUrl();
  const headers = serviceHeaders({ prefer: "return=minimal" });
  if (!SB || !headers) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const patch = body?.action === "filled"
    ? { status: "filled", sig: typeof body?.sig === "string" ? body.sig.slice(0, 120) : null, filled_at: new Date().toISOString() }
    : { status: "cancelled" };
  const response = await fetchWithTimeout(`${SB}/rest/v1/limit_orders?id=eq.${encodeURIComponent(id)}&privy_user_id=eq.${encodeURIComponent(user.privyUserId)}`, {
    method: "PATCH", headers, body: JSON.stringify(patch)
  });
  if (!response.ok) return NextResponse.json({ error: "could not update order" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
