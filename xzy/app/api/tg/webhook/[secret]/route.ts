import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { handleUpdate } from "@/server/webhook";
import { createWebhookDeps } from "@/server/deps";
import { optionalEnv } from "@/lib/env";
import type { TgUpdate } from "@/lib/telegram/updates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram webhook receiver.
 *
 * Two independent checks guard it, and both must pass:
 *   1. A random path segment, so the endpoint is not discoverable by URL guessing.
 *   2. Telegram's `X-Telegram-Bot-Api-Secret-Token` header, set when the webhook is
 *      registered, which proves the request came from Telegram and not from someone
 *      who learned the URL from a log or a proxy.
 *
 * The response is always 200 once the request is authentic. Telegram retries on any
 * non-2xx, so returning an error for a malformed update would turn one bad message
 * into an indefinite redelivery loop.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export async function POST(req: Request, context: { params: Promise<{ secret: string }> }) {
  const configuredSecret = optionalEnv("TELEGRAM_WEBHOOK_SECRET");
  const configuredPath = optionalEnv("TELEGRAM_WEBHOOK_PATH");
  if (!configuredSecret || !configuredPath) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const { secret: pathSegment } = await context.params;
  if (!constantTimeEquals(pathSegment, configuredPath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const headerToken = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!constantTimeEquals(headerToken, configuredSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    // Authentic sender, unreadable body — acknowledge so it is not redelivered forever.
    return NextResponse.json({ ok: true, kind: "ignored", detail: "unparseable body" });
  }

  const outcome = await handleUpdate(update, createWebhookDeps());
  return NextResponse.json({ ok: true, ...outcome });
}
