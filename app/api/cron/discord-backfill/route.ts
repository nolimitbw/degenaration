import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { fetchWithTimeout } from "@/lib/server/guard";
import { isBotRequest } from "@/lib/server/bot-auth";

const { scanDiscordHistoryPage } = require("@/lib/server/discord-rest-backfill");

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const MAX_PAGES_PER_RUN = 6;

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
    const results = new Map<string, { channelId: string; scanned: number; accepted: number; rejected: number; completed: boolean; hasMore: boolean }>();
    const states = new Map<string, Record<string, unknown>>();
    for (const channel of rows) {
      states.set(channel.channel_id, await bridge("backfill_state", { p_channel_id: channel.channel_id }));
      results.set(channel.channel_id, {
        channelId: channel.channel_id,
        scanned: 0,
        accepted: 0,
        rejected: 0,
        completed: Boolean(states.get(channel.channel_id)?.completed_at),
        hasMore: true
      });
    }
    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      let pending = false;
      for (const channel of rows) {
        const total = results.get(channel.channel_id)!;
        if (!total.hasMore) continue;
        let state = states.get(channel.channel_id) || {};
        const pageResult = await scanDiscordHistoryPage({
          channel,
          state,
          token,
          ingest: (payload: Record<string, unknown>) => ingest(req.nextUrl.origin, payload),
          saveState: async (channelId: string, next: Record<string, unknown>) => {
            state = await bridge("update_backfill_state", {
              p_channel_id: channelId,
              p_newest_message_id: next.newestMessageId || null,
              p_oldest_message_id: next.oldestMessageId || null,
              p_completed: next.completed === true,
              p_messages_scanned: next.messagesScanned || 0,
              p_last_error: next.lastError || null
            });
            states.set(channelId, state);
          }
        });
        total.scanned += pageResult.scanned;
        total.accepted += pageResult.accepted;
        total.rejected += pageResult.rejected;
        total.completed = pageResult.completed;
        total.hasMore = pageResult.hasMore;
        if (pageResult.hasMore) pending = true;
      }
      if (!pending) break;
    }

    /**
     * LIVE MODE — near-real-time call detection without a hosted gateway listener.
     *
     * Discord only pushes MESSAGE_CREATE over a persistent WebSocket, and nothing here can hold
     * one open. The alternative is polling the REST API, and the limit on THAT is not Discord —
     * `GET /channels/{id}/messages` is comfortable at this volume — it is how often anything
     * gets to run. pg_cron's floor is one minute, which for a memecoin CA call is the difference
     * between the entry the caller saw and a materially worse one.
     *
     * So the invocation does the waiting. It sweeps every few seconds for most of a minute, and
     * pg_cron restarts it each minute. Detection drops from ~120s to ~5s, and the execution half
     * is already immediate: ingest fires /api/worker/tick?once=1, measured at 840ms.
     *
     * Only a channel that has FINISHED its archive sweeps here. One still walking backwards has
     * older pages to fetch and its own loop above already runs flat out; adding forward sweeps
     * would just contend for the same rate limit.
     *
     * This is a bridge, not the destination. A gateway listener detects in ~100ms and costs one
     * always-on process; when `degenaration-discord-bot` is hosted, drop the schedule back and
     * let this go back to being a backfill.
     */
    const live = req.nextUrl.searchParams.get("live") === "1";
    const LIVE_BUDGET_MS = 50_000;
    const SWEEP_INTERVAL_MS = 5_000;
    let sweeps = 0;

    if (live) {
      const started = Date.now();
      while (Date.now() - started < LIVE_BUDGET_MS) {
        await new Promise((resolve) => setTimeout(resolve, SWEEP_INTERVAL_MS));
        sweeps += 1;
        for (const channel of rows) {
          const total = results.get(channel.channel_id)!;
          // Forward polling only. `completed` is what flips scanDiscordHistoryPage from
          // paging `before` the oldest to fetching `after` the newest.
          if (!total.completed) continue;
          let state = states.get(channel.channel_id) || {};
          const pageResult = await scanDiscordHistoryPage({
            channel,
            state,
            token,
            ingest: (payload: Record<string, unknown>) => ingest(req.nextUrl.origin, payload),
            saveState: async (channelId: string, next: Record<string, unknown>) => {
              state = await bridge("update_backfill_state", {
                p_channel_id: channelId,
                p_newest_message_id: next.newestMessageId || null,
                p_oldest_message_id: next.oldestMessageId || null,
                p_completed: next.completed === true,
                p_messages_scanned: next.messagesScanned || 0,
                p_last_error: next.lastError || null
              });
              states.set(channelId, state);
            }
          });
          total.scanned += pageResult.scanned;
          total.accepted += pageResult.accepted;
          total.rejected += pageResult.rejected;
        }
      }
    }

    return NextResponse.json(
      { ok: true, live, sweeps, channels: [...results.values()] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: String((error as Error)?.message || error).slice(0, 300) }, { status: 502 });
  }
}
