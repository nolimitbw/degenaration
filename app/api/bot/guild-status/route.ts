import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  if (!isBotRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const distributed = await distributedRateLimit(req, {
    limit: 120,
    windowSeconds: 60,
    scope: "discord:guild-status",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  const secret = process.env.BOT_SHARED_SECRET!;
  const guildId = req.nextUrl.searchParams.get("guild_id");
  if (!isDiscordSnowflake(guildId)) return NextResponse.json({ error: "invalid guild" }, { status: 400 });
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const response = await fetchWithTimeout(bridgeUrl, {
    method: "POST",
    headers: botBridgeHeaders,
    cache: "no-store",
    body: JSON.stringify({ operation: "guild_status", p_secret: secret, p_guild_id: guildId })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: "status query failed", status: response.status }, { status: 502 });

  return NextResponse.json(data ?? { channels: [], profile: null, topCallers: [] }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
