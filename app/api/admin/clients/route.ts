import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { boundedInteger } from "@/lib/server/product";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

/**
 * GET /api/admin/clients — the operator's view of every client and the business totals.
 *
 * Spec section 8. Both RPCs aggregate trade_executions, positions, trade_intents and
 * withdrawal_intents; none of those had a writer before the settlement writer landed, so this
 * endpoint would previously have reported zero for every client and looked identical to a
 * broken query.
 *
 * Authorization is deliberately three-deep, matching the other owner-only routes:
 *   1. requireAdmin proves the caller holds a verified admin session,
 *   2. the legacy-session refusal blocks the weaker pre-verification path,
 *   3. the RPC itself re-checks the actor against require_app_admin server-side.
 * The third is what matters if this route is ever called by something other than the console:
 * the shared secret authenticates the edge function, the role check authorizes the person.
 *
 * There is no client balance in the response and that is not an omission — the product is
 * non-custodial, so the database cannot know one. `walletAddress` is returned for chain
 * lookup and `custodyModel` states this explicitly.
 */
export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;

  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) {
    return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  }

  const limit = boundedInteger(Number(req.nextUrl.searchParams.get("limit") || 100), 1, 500) || 100;

  const [clients, summary] = await Promise.all([
    callAdminRpc<Record<string, unknown>>("admin_client_ledger", {
      p_actor_privy_user_id: admin.privyUserId,
      p_limit: limit
    }),
    callAdminRpc<Record<string, unknown>>("admin_business_summary", {
      p_actor_privy_user_id: admin.privyUserId
    })
  ]);

  // Reported independently rather than failing the whole page: the client table and the
  // header totals are separate questions, and one being unavailable should not blank the
  // other. Mirrors the allSettled pattern the Affiliate and Portfolio dashboards use.
  if (!clients.ok && !summary.ok) {
    return NextResponse.json({ error: clients.error }, { status: clients.status });
  }

  return NextResponse.json(
    {
      clients: clients.ok ? clients.data : null,
      clientsError: clients.ok ? null : clients.error,
      summary: summary.ok ? summary.data : null,
      summaryError: summary.ok ? null : summary.error
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
