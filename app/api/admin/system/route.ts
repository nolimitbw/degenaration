import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { isObject, rpcResponse } from "@/lib/server/product";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  return rpcResponse(await callAdminRpc("admin_list_system_flags", {
    p_actor_privy_user_id: admin.privyUserId
  }));
}

export async function PATCH(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 20,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!isObject(body) || typeof body.flagKey !== "string" || body.flagKey.length > 100 || body.value === undefined || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "invalid system flag update" }, { status: 400 });
  }
  return rpcResponse(await callAdminRpc("admin_update_system_flag_v2", {
    p_actor_privy_user_id: admin.privyUserId,
    p_flag_key: body.flagKey,
    p_value: body.value,
    p_reason: body.reason.slice(0, 500)
  }));
}
