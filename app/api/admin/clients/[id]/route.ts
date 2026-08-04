import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

/**
 * GET /api/admin/clients/[id] — one client's full record.
 *
 * Spec section 8's client detail: balance breakdown, wallet history, deposits, withdrawals and
 * their intents, trade intents, executions, positions with lots and exits, fees, commissions,
 * referrals, bots, failed operations and audit events.
 *
 * `id` is a Privy user ID, not a UUID, so it is passed through as an opaque string and the RPC
 * decides whether it exists. It answers `{ ok: false, reason: "not-found" }` rather than
 * raising, so an unknown client is a rendered state and not an error banner.
 *
 * Authorization is the same three-deep check as the client table, and the third layer —
 * `require_app_admin` inside the RPC — is the one that holds if this route is ever called by
 * something other than the console.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;

  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) {
    return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  }

  const { id } = await params;
  if (!id || id.length > 200) {
    return NextResponse.json({ error: "invalid client id" }, { status: 400 });
  }

  const detail = await callAdminRpc<Record<string, unknown>>("admin_client_detail", {
    p_actor_privy_user_id: admin.privyUserId,
    p_privy_user_id: id
  });

  if (!detail.ok) {
    return NextResponse.json({ error: detail.error }, { status: detail.status });
  }

  return NextResponse.json(detail.data, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
