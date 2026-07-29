import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callPrivyRpc, requirePrivyUser } from "@/lib/server/privy";
import {
  REFERRAL_COOKIE_NAME,
  verifyReferralCapture
} from "@/lib/server/referral-capture";

function captureSecret() {
  return process.env.REFERRAL_SIGNING_SECRET || process.env.ADMIN_KEY || "";
}

function clearCapture(response: NextResponse) {
  response.cookies.set(REFERRAL_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0)
  });
  return response;
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 20,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;

  const user = await requirePrivyUser(req);
  if (!user.ok) return user.response;

  const encoded = req.cookies.get(REFERRAL_COOKIE_NAME)?.value;
  if (!encoded) return NextResponse.json({ ok: true, captured: false });

  const capture = verifyReferralCapture(encoded, captureSecret(), Date.now());
  if (!capture) {
    return clearCapture(NextResponse.json({ ok: true, captured: false, ignored: "invalid-or-expired" }));
  }

  const result = await callPrivyRpc<any>("app_user_complete_referral_attribution", {
    p_privy_user_id: user.privyUserId,
    p_code: capture.code,
    p_visitor_hash: capture.visitorHash,
    p_capture_nonce: capture.nonce,
    p_captured_at: new Date(capture.capturedAt * 1000).toISOString()
  });
  if (!result.ok) {
    const response = NextResponse.json({ error: result.error }, { status: result.status });
    return result.status >= 500 ? response : clearCapture(response);
  }
  return clearCapture(NextResponse.json(result.data));
}
