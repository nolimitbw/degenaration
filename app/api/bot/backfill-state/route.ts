import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

async function authorize(req: NextRequest) {
  const limited = rateLimit(req, { limit: 240, windowMs: 60_000 });
  if (limited) return limited;
  if (!isBotRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return distributedRateLimit(req, {
    limit: 240,
    windowSeconds: 60,
    scope: "discord:history-backfill",
    subject: "discord-bot",
    skipLocal: true
  });
}

async function bridge(operation: string, body: Record<string, unknown>) {
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const response = await fetchWithTimeout(bridgeUrl, {
    method: "POST",
    headers: botBridgeHeaders,
    cache: "no-store",
    body: JSON.stringify({ operation, p_secret: process.env.BOT_SHARED_SECRET!, ...body })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: "backfill state operation failed", status: response.status }, { status: 502 });
  return NextResponse.json(data ?? {}, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const channelId = req.nextUrl.searchParams.get("channel_id");
  if (!isDiscordSnowflake(channelId)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  return bridge("backfill_state", { p_channel_id: channelId });
}

export async function POST(req: NextRequest) {
  const denied = await authorize(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const channelId = typeof body?.channel_id === "string" ? body.channel_id : null;
  if (!isDiscordSnowflake(channelId)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  const newest = typeof body?.newest_message_id === "string" ? body.newest_message_id : null;
  const oldest = typeof body?.oldest_message_id === "string" ? body.oldest_message_id : null;
  if ((newest && !isDiscordSnowflake(newest)) || (oldest && !isDiscordSnowflake(oldest))) {
    return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  }
  const messagesScanned = Number(body?.messages_scanned || 0);
  if (!Number.isSafeInteger(messagesScanned) || messagesScanned < 0) {
    return NextResponse.json({ error: "invalid scan count" }, { status: 400 });
  }
  return bridge("update_backfill_state", {
    p_channel_id: channelId,
    p_newest_message_id: newest,
    p_oldest_message_id: oldest,
    p_completed: body?.completed === true,
    p_messages_scanned: messagesScanned,
    p_last_error: typeof body?.last_error === "string" ? body.last_error.slice(0, 500) : null
  });
}
