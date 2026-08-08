import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";

export async function POST(req: NextRequest) {
  const local = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (local) return local;
  if (!isBotRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const distributed = await distributedRateLimit(req, {
    limit: 30,
    windowSeconds: 60,
    scope: "discord:create-owner-link",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  const body = await req.json().catch(() => null);
  const guildId = typeof body?.guild_id === "string" ? body.guild_id.trim() : "";
  const discordUserId = typeof body?.discord_user_id === "string" ? body.discord_user_id.trim() : "";
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(discordUserId) || body?.manage_guild_verified !== true) {
    return NextResponse.json({ error: "verified Manage Server interaction required" }, { status: 403 });
  }
  const bridgeUrl = getBotBridgeUrl();
  const secret = process.env.BOT_SHARED_SECRET;
  if (!bridgeUrl || !secret) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const response = await fetchWithTimeout(bridgeUrl, {
    method: "POST",
    headers: botBridgeHeaders,
    body: JSON.stringify({
      operation: "create_owner_link",
      p_secret: secret,
      p_guild_id: guildId,
      p_discord_user_id: discordUserId,
      p_discord_username: typeof body?.discord_username === "string" ? body.discord_username.trim().slice(0, 100) : null,
      p_manage_guild_verified: true
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok === false) {
    return NextResponse.json({ error: data?.error || "owner link could not be created" }, { status: response.status === 401 ? 502 : 400 });
  }
  return NextResponse.json(data);
}
