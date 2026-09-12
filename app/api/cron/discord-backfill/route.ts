import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { fetchWithTimeout } from "@/lib/server/guard";
import { isBotRequest } from "@/lib/server/bot-auth";

const { scanDiscordHistoryPage } = require("@/lib/server/discord-rest-backfill");

export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
    /**
     * NO channel discovery.
     *
     * A previous revision enumerated every channel of an approved guild and registered them
     * all. The owner's specification is explicit and is the better design: the channel chosen
     * during /register is the only one monitored. A server's calls channel is a deliberate
     * choice, and scanning #general or #all-discussion would journal every address anyone
     * pastes in conversation as if the owner had called it — which is worse than missing a
     * call, because it is a fabricated call attributed to them.
     *
     * bot_autoregister_guild_channels remains in the schema, unused and unreachable from the
     * bridge, and its rows were removed. The per-channel error isolation added alongside it
     * stays: it was a real fault independent of discovery.
     */
    let skipped = 0;

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
        /**
         * One unreadable channel must never stop the others.
         *
         * scanDiscordHistoryPage throws on any non-ok Discord response, and that propagated
         * out of this loop and returned 502 for the whole run. It was survivable only while
         * every registered channel was hand-picked and readable; the moment discovery added a
         * private channel — #priv, #moderator-only, a ticket — a single 403 "Missing Access"
         * silenced EVERY source. Which is precisely the failure mode this scanner exists to
         * avoid, and it would have arrived with the first server that has a locked channel.
         *
         * The channel is marked done for this run so it is not retried in the page loop, and
         * the reason is recorded on its state rather than thrown away.
         */
        let pageResult;
        try {
          pageResult = await scanDiscordHistoryPage({
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
        } catch (error) {
          total.hasMore = false;
          (total as any).error = String((error as Error)?.message || error).slice(0, 120);
          skipped += 1;
          continue;
        }
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
     * `live=1` remains compatible with the existing scheduler, but this serverless fallback
     * never waits between polls. The archive/forward scan above already performs the current
     * pass. A previous 50-second polling loop exhausted Vercel's free compute allowance because
     * two scheduled functions stayed resident for nearly every second of every minute.
     *
     * Near-real-time delivery belongs to the Discord Gateway service. This route is the durable,
     * once-per-schedule recovery path when the gateway misses an event.
     */
    const live = req.nextUrl.searchParams.get("live") === "1";
    const sweeps = 0;

    return NextResponse.json(
      { ok: true, live, sweeps, skipped, channels: [...results.values()] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: String((error as Error)?.message || error).slice(0, 300) }, { status: 502 });
  }
}
