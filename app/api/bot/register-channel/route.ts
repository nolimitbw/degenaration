import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || null : null;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  if (!isBotRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const distributed = await distributedRateLimit(req, {
    limit: 60,
    windowSeconds: 60,
    scope: "discord:register-channel",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  const secret = process.env.BOT_SHARED_SECRET!;
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const guildId = cleanText(body?.guild_id, 64);
  const channelId = cleanText(body?.channel_id, 64);
  if (!isDiscordSnowflake(guildId) || !isDiscordSnowflake(channelId)) {
    return NextResponse.json({ error: "invalid Discord guild or channel" }, { status: 400 });
  }

  const response = await fetchWithTimeout(bridgeUrl, {
    method: "POST",
    headers: botBridgeHeaders,
    body: JSON.stringify({
      operation: "register_channel",
      p_secret: secret,
      p_guild_id: guildId,
      p_guild_name: cleanText(body?.guild_name, 120),
      p_guild_member_count: Number.isFinite(Number(body?.guild_member_count)) ? Number(body.guild_member_count) : null,
      p_channel_id: channelId,
      p_channel_name: cleanText(body?.channel_name, 120),
      p_registered_by: cleanText(body?.registered_by, 120)
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error || "registration failed", upstreamStatus: response.status },
      { status: response.status === 401 ? 502 : 502 }
    );
  }
  if (data?.ok === false) return NextResponse.json({ error: data.error || "registration failed" }, { status: data.status || 400 });
  return NextResponse.json(data ?? { ok: true });
}
