import { NextRequest, NextResponse } from "next/server";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { safeDiscordImage } from "@/lib/external-url";

const cleanText = (value: unknown, max: number) => {
  if (typeof value !== "string") return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || null;
};

function discordImage(value: unknown) {
  if (value == null || value === "") return null;
  return safeDiscordImage(value);
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 90, windowMs: 60_000 });
  if (limited) return limited;
  if (!isBotRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const distributed = await distributedRateLimit(req, {
    limit: 90,
    windowSeconds: 60,
    scope: "discord:sync-source-profile",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const guildId = cleanText(body.guild_id, 64);
  if (!isDiscordSnowflake(guildId)) {
    return NextResponse.json({ error: "invalid Discord guild" }, { status: 400 });
  }

  const avatarUrl = discordImage(body.avatar_url);
  const bannerUrl = discordImage(body.banner_url);
  if ((body.avatar_url && !avatarUrl) || (body.banner_url && !bannerUrl)) {
    return NextResponse.json({ error: "invalid Discord image URL" }, { status: 400 });
  }

  const rawMembers = body.guild_member_count == null ? Number.NaN : Number(body.guild_member_count);
  const memberCount = Number.isInteger(rawMembers) && rawMembers >= 0 && rawMembers <= 100_000_000
    ? rawMembers
    : null;
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const response = await fetchWithTimeout(bridgeUrl, {
    method: "POST",
    headers: botBridgeHeaders,
    body: JSON.stringify({
      operation: "sync_source_profile",
      p_secret: process.env.BOT_SHARED_SECRET!,
      p_guild_id: guildId,
      p_guild_name: cleanText(body.guild_name, 120),
      p_guild_member_count: memberCount,
      p_avatar_url: avatarUrl,
      p_banner_url: bannerUrl,
      p_description: cleanText(body.description, 300),
      p_owner_display_name: cleanText(body.owner_display_name, 100),
      p_bot_present: body.bot_present === true,
      p_sync_error: cleanText(body.sync_error, 300)
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      { error: data?.error || "profile synchronization failed", upstreamStatus: response.status },
      { status: 502 }
    );
  }
  if (data?.ok === false) {
    return NextResponse.json({ error: data.error || "profile synchronization failed" }, { status: data.status || 400 });
  }
  return NextResponse.json(data ?? { ok: true });
}
