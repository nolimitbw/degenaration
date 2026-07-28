import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { UUID_RE, rpcResponse } from "@/lib/server/product";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  return rpcResponse(await callAdminRpc("admin_list_kol_strategies", {
    p_actor_privy_user_id: admin.privyUserId,
    p_status: req.nextUrl.searchParams.get("status"),
    p_limit: 250
  }));
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 30,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!UUID_RE.test(body?.strategyId || "") || !["approve", "reject", "suspend", "request-changes"].includes(body?.action)) {
    return NextResponse.json({ error: "invalid moderation request" }, { status: 400 });
  }
  return rpcResponse(await callAdminRpc("admin_decide_kol_strategy", {
    p_actor_privy_user_id: admin.privyUserId,
    p_strategy_id: body.strategyId,
    p_action: body.action,
    p_reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : ""
  }));
}
