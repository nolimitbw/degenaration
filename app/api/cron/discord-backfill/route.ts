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
    /**
     * Discover every channel of an already-approved server before scanning.
     *
     * The scanner only polled channels a human had registered by hand, so a server whose
     * calls live in more than one channel — or that moved them — went silent with no error:
     * "nobody registered that channel" and "that channel is quiet" look identical from here.
     * Observed live: #alpha-futures active 2 hours ago and invisible, while the registered
     * #sol-alpha had been silent for 46.
     *
     * The approval boundary does not move. bot_autoregister_guild_channels refuses unless the
     * guild ALREADY has an approved source, so this can only widen a server whose owner
     * already asked to be listed — which is what they mean by adding the bot to their server.
     *
     * Best-effort and before the scan: a discovery failure must not stop the calls that the
     * known channels are producing right now.
     */
    let discovered = 0;
    let skipped = 0;
    try {
      const known = await bridge("approved_channels", {});
      const guilds = [...new Set((Array.isArray(known) ? known : [])
        .map((channel: any) => channel?.guild_id).filter(Boolean))];
      for (const guildId of guilds) {
        const response = await fetchWithTimeout(
          `https://discord.com/api/v10/guilds/${guildId}/channels`,
          { headers: { authorization: `Bot ${token}` }, cache: "no-store" }, 8_000
        );
        if (!response.ok) continue;
        const list = await response.json().catch(() => []);
        const text = (Array.isArray(list) ? list : [])
          // 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT. Voice, categories and forums carry no
          // message history to poll on this endpoint.
          .filter((channel: any) => channel?.type === 0 || channel?.type === 5)
          .map((channel: any) => ({ id: channel.id, name: channel.name }));
        if (!text.length) continue;
        const result = await bridge("autoregister_guild_channels", {
          p_guild_id: guildId,
          p_channels: text
        });
        discovered += Number(result?.added || 0);
      }
    } catch { /* discovery is best-effort; the scan below still runs */ }

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
          // Same isolation as the archive loop. A private channel throwing here would end the
          // live sweep for every source, and this loop is the real-time path — the one that
          // decides whether a call lands in seconds or not at all.
          if ((total as any).error) continue;
          let state = states.get(channel.channel_id) || {};
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
            (total as any).error = String((error as Error)?.message || error).slice(0, 120);
            skipped += 1;
            continue;
          }
          total.scanned += pageResult.scanned;
          total.accepted += pageResult.accepted;
          total.rejected += pageResult.rejected;
        }
      }
    }

    return NextResponse.json(
      { ok: true, live, sweeps, discovered, skipped, channels: [...results.values()] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: String((error as Error)?.message || error).slice(0, 300) }, { status: 502 });
  }
}
