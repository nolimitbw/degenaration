import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

/**
 * Platform revenue, owner-only.
 *
 * Separate from /api/admin/summary because it answers a different question and carries a
 * reconciliation verdict the rest of the dashboard does not: `allocationDrift` is the figure an
 * operator has to check before trusting any other number on the page, and burying it inside a
 * twelve-section bulk payload is how it would be missed.
 */
export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const result = await callAdminRpc("admin_revenue_summary", {
    p_actor_privy_user_id: admin.privyUserId
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { revenue: result.data },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
