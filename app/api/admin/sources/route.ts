import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { UUID_RE, rpcResponse } from "@/lib/server/product";

export async function POST(req: NextRequest) {
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
  if (!UUID_RE.test(body?.sourceGroupId || "") || !["suspend", "reactivate", "remove", "reapprove"].includes(body?.action)) {
    return NextResponse.json({ error: "invalid source action" }, { status: 400 });
  }
  if (["suspend", "remove", "reapprove"].includes(body.action) && (typeof body.reason !== "string" || !body.reason.trim())) {
    return NextResponse.json({ error: "reason required" }, { status: 400 });
  }
  return rpcResponse(await callAdminRpc("admin_source_action", {
    p_actor_privy_user_id: admin.privyUserId,
    p_source_group_id: body.sourceGroupId,
    p_action: body.action,
    p_reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : ""
  }));
}
