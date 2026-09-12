import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { callAppBridge } from "@/lib/server/app-bridge";
import { rateLimit } from "@/lib/server/guard";

type Options = {
  limit: number;
  windowSeconds: number;
  scope?: string;
  subject?: string;
  failClosed?: boolean;
  skipLocal?: boolean;
};

type RateLimitResult = {
  allowed?: boolean;
  retryAfterSeconds?: number;
};

function clientSubject(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function distributedRateLimit(req: NextRequest, options: Options) {
  if (!options.skipLocal) {
    const local = rateLimit(req, {
      limit: options.limit,
      windowMs: options.windowSeconds * 1000
    });
    if (local) return local;
  }

  const subject = options.subject || clientSubject(req);
  const salt = process.env.RATE_LIMIT_HASH_SALT || process.env.ADMIN_KEY || "degenaration";
  const subjectHash = createHash("sha256").update(`${salt}:${subject}`).digest("hex");
  const scope = options.scope || `${req.method}:${req.nextUrl.pathname}`;
  const result = await callAppBridge<RateLimitResult>("app_consume_rate_limit", {
    p_scope: scope,
    p_subject_hash: subjectHash,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
    p_cost: 1
  });

  if (!result.ok) {
    return options.failClosed
      ? NextResponse.json({ error: "request protection temporarily unavailable" }, { status: 503 })
      : null;
  }
  // A malformed-but-successful response must not be read as permission. `allowed !== false`
  // silently permitted `{}` or any shape missing the field, so a bridge that answered 200
  // with an unexpected body disabled the limit entirely — and failClosed did not cover it,
  // because that only guards `!result.ok`.
  if (typeof result.data?.allowed !== "boolean") {
    return options.failClosed
      ? NextResponse.json({ error: "request protection temporarily unavailable" }, { status: 503 })
      : null;
  }
  if (result.data.allowed) return null;

  const retry = Math.max(1, Number(result.data.retryAfterSeconds) || options.windowSeconds);
  return NextResponse.json(
    { error: "rate limit exceeded" },
    { status: 429, headers: { "retry-after": String(retry) } }
  );
}
