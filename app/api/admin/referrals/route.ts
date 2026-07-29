import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { rpcResponse } from "@/lib/server/product";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) {
    return NextResponse.json({ error: "verified owner session required" }, { status: 403 });
  }

  const query = req.nextUrl.searchParams.get("q")?.trim().slice(0, 120) || null;
  return rpcResponse(await callAdminRpc("admin_list_referrals_v2", {
    p_actor_privy_user_id: admin.privyUserId,
    p_query: query,
    p_limit: 250
  }));
}
