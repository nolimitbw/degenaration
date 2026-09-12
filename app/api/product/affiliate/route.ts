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
  const [affiliate, ownership] = await Promise.all([
    callPrivyRpc<any>("app_user_affiliate_summary", {
      p_privy_user_id: user.privyUserId,
      p_scope: scope
    }),
    scope === "discord"
      ? callPrivyRpc<any>("app_user_discord_ownership_summary", { p_privy_user_id: user.privyUserId })
      : Promise.resolve(null)
  ]);
  if (!affiliate.ok) return rpcResponse(affiliate);
  return rpcResponse({
    ok: true as const,
    data: {
      ...affiliate.data,
      ...(ownership?.ok ? { discordOwnership: ownership.data } : {})
    }
  });
}
