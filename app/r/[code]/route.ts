import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSourceSlugByReferral } from "@/lib/publicSource";
import { callAppBridge } from "@/lib/server/app-bridge";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import {
  CAPTURE_WINDOW_SECONDS,
  REFERRAL_COOKIE_NAME,
  createReferralCapture
} from "@/lib/server/referral-capture";

function captureSecret() {
  return process.env.REFERRAL_SIGNING_SECRET || process.env.ADMIN_KEY || "";
}

function redirectWithCapture(req: NextRequest, destination: string, code: string, visitorHash: string) {
  const target = new URL(destination, req.url);
  target.searchParams.set("ref", code.toLowerCase());
  const response = NextResponse.redirect(target, 307);
  const capture = createReferralCapture({ code, visitorHash, now: Date.now() }, captureSecret());
  if (capture) {
    response.cookies.set(REFERRAL_COOKIE_NAME, capture, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: CAPTURE_WINDOW_SECONDS
    });
  }
  return response;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const code = (await params).code.trim();
  if (!/^[a-z0-9_-]{6,48}$/i.test(code)) {
    return NextResponse.json({ error: "referral not found" }, { status: 404 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")
    || "unknown";
  const userAgent = req.headers.get("user-agent") || "unknown";
  const secret = captureSecret();
  if (!secret) {
    return NextResponse.json({ error: "referral service unavailable" }, { status: 503 });
  }
  const visitorHash = createHmac("sha256", secret)
    .update(`${ip}:${userAgent}`)
    .digest("hex");
  const clickWindow = Math.floor(Date.now() / 3_600_000);
  const idempotencyKey = createHmac("sha256", secret)
    .update(`referral-click:${code.toLowerCase()}:${visitorHash}:${clickWindow}`)
    .digest("hex");

  const resolved = await callAppBridge<{ destination?: string; canonicalCode?: string }>("app_public_resolve_referral", {
    p_code: code,
    p_visitor_hash: visitorHash,
    p_idempotency_key: idempotencyKey
  });
  if (resolved.ok) {
    const destination = String(resolved.data.destination || "");
    if (!destination.startsWith("/") || destination.startsWith("//")) {
      return NextResponse.json({ error: "referral destination unavailable" }, { status: 502 });
    }
    return redirectWithCapture(req, destination, resolved.data.canonicalCode || code, visitorHash);
  }

  // Preserve links issued to approved Discord groups before profile links existed.
  const slug = await getSourceSlugByReferral(code);
  if (!slug) {
    return NextResponse.json(
      { error: resolved.status === 404 ? "referral not found" : "referral service unavailable" },
      { status: resolved.status === 404 ? 404 : 503 }
    );
  }
  return NextResponse.redirect(new URL(`/source/${slug}?ref=${encodeURIComponent(code.toLowerCase())}`, req.url), 307);
}
