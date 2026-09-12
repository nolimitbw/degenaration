import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

/**
 * POST /api/admin/performance — recompute performance snapshots from the ledger.
 *
 * Spec 13 and 9.6. Portfolio performance, the My Bots performance column, the KOL cards and
 * the Discord marketplace 1D/7D/30D figures all read app_private.performance_snapshots, and
 * nothing wrote it until the refresh landed. This is the operator's way to run that refresh
 * before a scheduled worker exists (E-3).
 *
 * It computes only from immutable reconciled data, so it cannot invent a figure: a subject
 * with no executions still gets no row, and the surfaces keep showing "tracking".
 *
 * POST rather than GET because it writes. Authorization is the same three-deep check the
 * other owner-only routes use, and `require_app_admin` re-checks the actor inside the RPC.
 */
export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 10, windowSeconds: 60 });
  if (limited) return limited;

  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) {
    return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  }

  const result = await callAdminRpc<Record<string, unknown>>("admin_refresh_performance", {
    p_actor_privy_user_id: admin.privyUserId
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
