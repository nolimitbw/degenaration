import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSourceSlugByReferral } from "@/lib/publicSource";
import { callAppBridge } from "@/lib/server/app-bridge";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

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
  const salt = process.env.REFERRAL_HASH_SALT || process.env.ADMIN_KEY || "degenaration";
  const visitorHash = createHash("sha256")
    .update(`${salt}:${ip}:${userAgent}`)
    .digest("hex");
  const clickWindow = Math.floor(Date.now() / 3_600_000);
  const idempotencyKey = createHash("sha256")
    .update(`referral-click:${code.toLowerCase()}:${visitorHash}:${clickWindow}`)
    .digest("hex");

  const resolved = await callAppBridge<{ destination?: string }>("app_public_resolve_referral", {
    p_code: code,
    p_visitor_hash: visitorHash,
    p_idempotency_key: idempotencyKey
  });
  if (resolved.ok) {
    const destination = String(resolved.data.destination || "");
    if (!destination.startsWith("/") || destination.startsWith("//")) {
      return NextResponse.json({ error: "referral destination unavailable" }, { status: 502 });
    }
    const target = new URL(destination, req.url);
    target.searchParams.set("ref", code.toUpperCase());
    return NextResponse.redirect(target, 307);
  }

  // Preserve links issued to approved Discord groups before profile links existed.
  const slug = await getSourceSlugByReferral(code);
  if (!slug) {
    return NextResponse.json(
      { error: resolved.status === 404 ? "referral not found" : "referral service unavailable" },
      { status: resolved.status === 404 ? 404 : 503 }
    );
  }
  return NextResponse.redirect(new URL(`/source/${slug}?ref=${encodeURIComponent(code)}`, req.url), 307);
}
