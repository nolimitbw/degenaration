import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { isMint } from "@/lib/server/guard";
import { exactLamports, rpcResponse } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 5,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const body = await req.json().catch(() => null);
  const destination = typeof body?.destinationWallet === "string" ? body.destinationWallet.trim() : "";
  if (!isMint(destination)) return NextResponse.json({ error: "invalid destination wallet" }, { status: 400 });
  if (body?.confirmed !== true) return NextResponse.json({ error: "payout confirmation required" }, { status: 400 });
  const grossLamports = exactLamports(body?.grossLamports, BigInt("9000000000000000"));
  if (!grossLamports || BigInt(grossLamports) < BigInt("100000000")) {
    return NextResponse.json({ error: "minimum payout is 0.1 SOL" }, { status: 400 });
  }
  return rpcResponse(await callPrivyRpc("app_user_request_payout", {
    p_privy_user_id: user.privyUserId,
    p_destination_wallet: destination,
    p_gross_lamports: grossLamports
  }));
}
