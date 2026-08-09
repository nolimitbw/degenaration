import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { fetchWithTimeout } from "@/lib/server/guard";
import { isBotRequest } from "@/lib/server/bot-auth";

const { scanDiscordHistoryPage } = require("@/lib/server/discord-rest-backfill");

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isCronRequest(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && timingSafeEqual(digest(expected!), digest(supplied!)));
}

async function bridge(operation: string, params: Record<string, unknown>) {
  const url = getBotBridgeUrl();
  if (!url) throw new Error("bot bridge is not configured");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: botBridgeHeaders,
    cache: "no-store",
    body: JSON.stringify({ operation, p_secret: process.env.BOT_SHARED_SECRET, ...params })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `bridge operation failed (${response.status})`);
  return data;
}

async function ingest(origin: string, payload: Record<string, unknown>) {
  const response = await fetchWithTimeout(`${origin}/api/ingest-call`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-secret": process.env.BOT_SHARED_SECRET! },
    cache: "no-store",
    body: JSON.stringify(payload)
  }, 15_000);
  const data = await response.json().catch(() => null);
  if (response.ok) return { accepted: data?.accepted !== false };
  if (response.status >= 400 && response.status < 500) return { rejected: true };
  throw new Error(data?.error || `call ingestion failed (${response.status})`);
}

export async function GET(req: NextRequest) {
  if (!isBotRequest(req) && !isCronRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || !process.env.BOT_SHARED_SECRET) {
    return NextResponse.json({ error: "Discord scanner is not configured" }, { status: 503 });
  }

  try {
    const channels = await bridge("approved_channels", {});
    const rows = Array.isArray(channels) ? channels : [];
    const results = [];
    for (const channel of rows) {
      const state = await bridge("backfill_state", { p_channel_id: channel.channel_id });
      results.push(await scanDiscordHistoryPage({
        channel,
        state,
        token,
        ingest: (payload: Record<string, unknown>) => ingest(req.nextUrl.origin, payload),
        saveState: (channelId: string, next: Record<string, unknown>) => bridge("update_backfill_state", {
          p_channel_id: channelId,
          p_newest_message_id: next.newestMessageId || null,
          p_oldest_message_id: next.oldestMessageId || null,
          p_completed: next.completed === true,
          p_messages_scanned: next.messagesScanned || 0,
          p_last_error: next.lastError || null
        })
      }));
    }
    return NextResponse.json({ ok: true, channels: results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String((error as Error)?.message || error).slice(0, 300) }, { status: 502 });
  }
}
