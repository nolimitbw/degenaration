import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { boundedInteger, rpcResponse, UUID_RE } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const botId = req.nextUrl.searchParams.get("botId") || "";
  if (!UUID_RE.test(botId)) return NextResponse.json({ error: "invalid bot id" }, { status: 400 });
  const limit = boundedInteger(Number(req.nextUrl.searchParams.get("limit") || 100), 1, 200) || 100;
  return rpcResponse(await callPrivyRpc("app_user_get_bot_activity", {
    p_privy_user_id: user.privyUserId,
    p_bot_id: botId,
    p_limit: limit
  }));
}
