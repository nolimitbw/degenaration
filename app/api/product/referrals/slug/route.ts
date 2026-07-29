import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";
import { rpcResponse } from "@/lib/server/product";
import { validateReferralSlug } from "@/lib/referral-rules";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const validation = validateReferralSlug(req.nextUrl.searchParams.get("slug") || "");
  if (!validation.ok) {
    return NextResponse.json({
      ok: true,
      slug: null,
      valid: false,
      available: false,
      reason: validation.error
    });
  }
  return rpcResponse(await callPrivyRpc("app_user_check_referral_slug", {
    p_privy_user_id: user.privyUserId,
    p_slug: validation.slug
  }));
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 10,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  let body: { slug?: unknown; confirmed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const validation = validateReferralSlug(body.slug);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });
  if (body.confirmed !== true) return NextResponse.json({ error: "confirmation required" }, { status: 400 });

  return rpcResponse(await callPrivyRpc("app_user_change_referral_slug", {
    p_privy_user_id: user.privyUserId,
    p_slug: validation.slug,
    p_confirmed: true
  }));
}
