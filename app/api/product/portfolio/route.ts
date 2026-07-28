import { NextRequest } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { normalizePeriod, rpcResponse } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const period = normalizePeriod(req.nextUrl.searchParams.get("period"), ["7d", "30d", "3m"], "30d");
  return rpcResponse(await callPrivyRpc("app_user_portfolio_summary", {
    p_privy_user_id: user.privyUserId,
    p_period: period
  }));
}
