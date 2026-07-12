import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const result = await callPrivyRpc<any[]>("app_user_list_trades", { p_privy_user_id: user.privyUserId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ trades: Array.isArray(result.data) ? result.data : [] });
}
