import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { UUID_RE, rpcResponse } from "@/lib/server/product";

const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,120}$/;

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  return rpcResponse(await callAdminRpc("admin_list_payout_requests", {
    p_actor_privy_user_id: admin.privyUserId,
    p_status: req.nextUrl.searchParams.get("status"),
    p_limit: 250
  }));
}

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
  if (!UUID_RE.test(body?.payoutId || "") || !["review", "approve", "processing", "confirm", "fail", "reject"].includes(body?.action)) {
    return NextResponse.json({ error: "invalid payout action" }, { status: 400 });
  }
  if (body.action === "confirm" && !SOLANA_SIGNATURE_RE.test(body?.txSignature || "")) {
    return NextResponse.json({ error: "valid Solana transaction signature required" }, { status: 400 });
  }
  return rpcResponse(await callAdminRpc("admin_decide_payout_v2", {
    p_actor_privy_user_id: admin.privyUserId,
    p_payout_id: body.payoutId,
    p_action: body.action,
    p_reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "",
    p_tx_signature: typeof body.txSignature === "string" ? body.txSignature.slice(0, 120) : null
  }));
}
