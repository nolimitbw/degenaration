import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

/**
 * Withdrawing DegenAration's own platform revenue.
 *
 * THREE THINGS THIS ROUTE DELIBERATELY DOES NOT DO
 *
 * 1. It does not decide how much is available. The bound is computed inside
 *    `admin_open_revenue_withdrawal`, under an advisory lock on the mint, in the same
 *    statement that inserts. A client-supplied "available" figure is the classic way a
 *    withdrawal overdraws, and a route-computed one races with itself.
 *
 * 2. It does not sign. Signing platform revenue out of the fee account is an owner action with
 *    an owner-held key. A server that could do it unattended would be a larger risk than the
 *    feature is worth, so the flow is: open (idempotent) → owner signs → record signature →
 *    confirm → reconcile.
 *
 * 3. It cannot reach client principal. Not by policy — by construction. The only figure the
 *    RPC can draw against is `sum(retained_fee_lamports)` over reconciled executions, a fee
 *    already deducted from a trade that confirmed. No query in that path reads a client
 *    balance, and creator and referral allocations were subtracted before `retained` exists.
 */

const OUTCOMES = new Set(["confirmed", "failed", "reversed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const result = await callAdminRpc("admin_list_revenue_withdrawals", {
    p_actor_privy_user_id: admin.privyUserId,
    p_limit: 50
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(req: NextRequest) {
  // Deliberately tighter than the read, and fail-closed: a rate limiter that opens up when its
  // own backend is unavailable is not a limiter on the path that moves money.
  const limited = await distributedRateLimit(req, { limit: 10, windowSeconds: 60, failClosed: true });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "open";

  if (action === "open") {
    const mint = typeof body?.mint === "string" ? body.mint.trim() : "";
    const destination = typeof body?.destination === "string" ? body.destination.trim() : "";
    // Accepted as a STRING and passed through untouched. Parsing a lamport amount into a
    // JavaScript number loses precision above 2^53, and this is the one field where losing
    // precision means moving the wrong amount of money.
    const amount = typeof body?.amountBaseUnits === "string" ? body.amountBaseUnits.trim() : "";
    if (!mint || !destination || !/^[1-9][0-9]{0,19}$/.test(amount)) {
      return NextResponse.json({ error: "mint, destination and a positive integer amount are required" }, { status: 400 });
    }
    const result = await callAdminRpc("admin_open_revenue_withdrawal", {
      p_actor_privy_user_id: admin.privyUserId,
      p_mint: mint,
      p_destination_address: destination,
      p_amount_base_units: amount
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  }

  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "invalid withdrawal id" }, { status: 400 });

  if (action === "sign") {
    const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
    if (!signature) return NextResponse.json({ error: "signature is required" }, { status: 400 });
    const result = await callAdminRpc("admin_record_revenue_withdrawal_signature", {
      p_actor_privy_user_id: admin.privyUserId,
      p_id: id,
      p_tx_signature: signature
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  }

  if (action === "settle") {
    const outcome = typeof body?.outcome === "string" ? body.outcome : "";
    if (!OUTCOMES.has(outcome)) return NextResponse.json({ error: "invalid outcome" }, { status: 400 });
    const result = await callAdminRpc("admin_settle_revenue_withdrawal", {
      p_actor_privy_user_id: admin.privyUserId,
      p_id: id,
      p_outcome: outcome,
      p_error: typeof body?.error === "string" ? body.error.slice(0, 400) : null
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.data);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
