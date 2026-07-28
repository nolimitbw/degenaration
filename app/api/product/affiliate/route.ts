import { NextRequest } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { rpcResponse } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const requestedScope = req.nextUrl.searchParams.get("scope");
  const scope = requestedScope === "discord" || requestedScope === "kol" ? requestedScope : "all";
  return rpcResponse(await callPrivyRpc("app_user_affiliate_summary", {
    p_privy_user_id: user.privyUserId,
    p_scope: scope
  }));
}
