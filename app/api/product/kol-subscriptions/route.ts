import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { BASE58_RE, UUID_RE, boundedInteger, exactLamports, isObject, rpcResponse } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { automationReadiness } from "@/lib/server/automation-readiness";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  return rpcResponse(await callPrivyRpc("app_user_list_kol_subscriptions", {
    p_privy_user_id: user.privyUserId
  }));
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 30,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const body = await req.json().catch(() => null);
  if (!isObject(body) || typeof body.strategyId !== "string" || !UUID_RE.test(body.strategyId)) {
    return NextResponse.json({ error: "invalid strategy" }, { status: 400 });
  }
  const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress.trim() : "";
  const walletId = typeof body.walletId === "string" ? body.walletId.trim() : "";
  if (!BASE58_RE.test(walletAddress) || !walletId) {
    return NextResponse.json({ error: "verified execution wallet required" }, { status: 400 });
  }
  const ownership = await requirePrivyWallet(req, user.privyUserId, walletAddress, walletId);
  if (!ownership.ok) return ownership.response;
  const lamportConfig = Object.fromEntries(
    ["buyAmountLamports", "maximumCapitalLamports", "dailyLossLimitLamports"].map((key) => [
      key,
      exactLamports(body[key], BigInt("100000000000"))
    ])
  );
  if (Object.values(lamportConfig).some((value) => value == null)) {
    return NextResponse.json({ error: "invalid capital limits" }, { status: 400 });
  }
  for (const [key, min, max] of [
    ["maxOpenTrades", 1, 100],
    ["slippageBps", 1, 2_000],
    ["priorityFeeMaxLamports", 0, 100_000_000]
  ] as const) {
    if (boundedInteger(body[key], min, max) == null) {
      return NextResponse.json({ error: `invalid ${key}` }, { status: 400 });
    }
  }
  const status = ["draft", "active", "paused", "archived"].includes(body.status) ? body.status : "draft";
  if (status === "active" && body.confirmed !== true) {
    return NextResponse.json({ error: "activation confirmation required" }, { status: 400 });
  }
  if (status === "active" && !ownership.delegated) {
    return NextResponse.json(
      { error: "Grant delegated execution to this wallet before activating the strategy.", code: "WALLET_NOT_DELEGATED" },
      { status: 409 }
    );
  }
  if (status === "active") {
    const readiness = await automationReadiness();
    // Same gate as the bot route: `tradable` excludes the revenue-only fee check, every
    // user-protecting check still blocks. Left on `active` this route would keep refusing
    // every KOL subscription while the bot route accepted, which is the worse failure —
    // two activation paths disagreeing about whether the product is open.
    if (!readiness.tradable) {
    return NextResponse.json(
      { error: readiness.reason, code: "AUTOMATION_RELEASE_LOCKED" },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
    }
  }
  return rpcResponse(await callPrivyRpc("app_user_upsert_kol_subscription", {
    p_privy_user_id: user.privyUserId,
    p_strategy_id: body.strategyId,
    p_payload: { ...body, ...lamportConfig, walletAddress, walletId, status }
  }));
}
