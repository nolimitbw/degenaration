import { NextRequest, NextResponse } from "next/server";
import { validateBotPayload } from "@/lib/server/bot-validation";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { rpcResponse, UUID_RE } from "@/lib/server/product";
import { callPrivyRpc, requirePrivyUser, requirePrivyWallet } from "@/lib/server/privy";
import { automationReadiness } from "@/lib/server/automation-readiness";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 90, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "invalid bot id" }, { status: 400 });
    return rpcResponse(await callPrivyRpc("app_user_get_bot", {
      p_privy_user_id: user.privyUserId,
      p_bot_id: id
    }));
  }
  const requestedKind = req.nextUrl.searchParams.get("kind");
  const kind = requestedKind === "discord" || requestedKind === "kol" ? requestedKind : null;
  return rpcResponse(await callPrivyRpc("app_user_list_bots", {
    p_privy_user_id: user.privyUserId,
    p_kind: kind
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
  const parsed = validateBotPayload(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.value.status === "active") {
    const readiness = await automationReadiness();
    // `tradable`, not `active`: the fee check protects revenue, not the user, and blocking on
    // it stopped every activation while defending nothing — with no bot able to run there were
    // no trades to take 2% of. Every check that guards the user still blocks here.
    if (!readiness.tradable) {
    return NextResponse.json(
      { error: readiness.reason, code: "AUTOMATION_RELEASE_LOCKED" },
      { status: 503, headers: { "Retry-After": "3600" } }
    );
    }
  }
  if (parsed.walletAddress) {
    const ownership = await requirePrivyWallet(req, user.privyUserId, parsed.walletAddress, parsed.walletId);
    if (!ownership.ok) return ownership.response;
  }
  const rpcName = parsed.value.status === "active"
    ? "app_user_save_bot"
    : "app_user_save_mainnet_bot_draft";
  return rpcResponse(await callPrivyRpc(rpcName, {
    p_privy_user_id: user.privyUserId,
    p_payload: parsed.value
  }));
}

export async function DELETE(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 20,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;
  const body = await req.json().catch(() => null) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || !UUID_RE.test(body.id)) {
    return NextResponse.json({ error: "invalid bot id" }, { status: 400 });
  }
  return rpcResponse(await callPrivyRpc("app_user_delete_bot", {
    p_privy_user_id: user.privyUserId,
    p_bot_id: body.id
  }));
}
