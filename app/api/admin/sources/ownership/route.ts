import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { UUID_RE, rpcResponse } from "@/lib/server/product";
import { isDiscordSnowflake } from "@/lib/server/bot-auth";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  return rpcResponse(await callAdminRpc("admin_list_discord_ownership", {
    p_actor_privy_user_id: admin.privyUserId,
    p_limit: 200
  }));
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 20, windowSeconds: 60, failClosed: true });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const action = body?.action === "assign" || body?.action === "revoke" ? body.action : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!UUID_RE.test(body?.sourceGroupId || "") || !action || !reason) {
    return NextResponse.json({ error: "source, action, and reason required" }, { status: 400 });
  }
  if (action === "assign" && (typeof body?.targetPrivyUserId !== "string" || !isDiscordSnowflake(body?.discordUserId))) {
    return NextResponse.json({ error: "verified target account and Discord identity required" }, { status: 400 });
  }
  return rpcResponse(await callAdminRpc("admin_resolve_discord_ownership", {
    p_actor_privy_user_id: admin.privyUserId,
    p_source_group_id: body.sourceGroupId,
    p_action: action,
    p_target_privy_user_id: action === "assign" ? body.targetPrivyUserId.trim() : null,
    p_discord_user_id: action === "assign" ? body.discordUserId : null,
    p_reason: reason
  }));
}
