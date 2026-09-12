import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isBotRequest, isDiscordSnowflake } from "@/lib/server/bot-auth";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";

const DISCORD_API = "https://discord.com/api/v10";

function deliveryNonce(value: string) {
  const digest = createHash("sha256").update(value).digest();
  return (digest.readBigUInt64BE(0) & BigInt("9223372036854775807")).toString();
}

function validPayload(body: any) {
  const embeds = Array.isArray(body?.embeds) ? body.embeds : [];
  const components = Array.isArray(body?.components) ? body.components : [];
  const content = typeof body?.content === "string" ? body.content.slice(0, 2000) : undefined;
  if (!content && embeds.length === 0) return null;
  if (embeds.length > 10 || components.length > 5) return null;
  return { content, embeds, components };
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  if (!isBotRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  const expectedGuildId = process.env.DISCORD_GUILD_ID;
  if (!token || !expectedGuildId) {
    return NextResponse.json({ error: "Discord delivery is not configured" }, { status: 503 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const channelId = body?.channel_id;
  if (!isDiscordSnowflake(channelId)) {
    return NextResponse.json({ error: "invalid Discord channel" }, { status: 400 });
  }

  const auth = { authorization: `Bot ${token}` };
  const channelResponse = await fetchWithTimeout(`${DISCORD_API}/channels/${channelId}`, {
    headers: auth,
    cache: "no-store"
  }, 8_000).catch(() => null);
  if (!channelResponse?.ok) {
    return NextResponse.json({ error: "Discord channel is unavailable" }, { status: 502 });
  }
  const channel = await channelResponse.json().catch(() => null);
  if (channel?.guild_id !== expectedGuildId) {
    return NextResponse.json({ error: "channel is outside the configured Discord server" }, { status: 403 });
  }
  if (body?.verify_only === true) {
    return NextResponse.json({ ok: true, channel_id: channelId, guild_id: channel.guild_id, channel_name: channel.name ?? null });
  }

  const payload = validPayload(body);
  const deliveryId = typeof body?.delivery_id === "string" ? body.delivery_id.trim().slice(0, 160) : "";
  if (!payload || !deliveryId) {
    return NextResponse.json({ error: "message payload and delivery_id are required" }, { status: 400 });
  }
  const response = await fetchWithTimeout(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ ...payload, nonce: deliveryNonce(deliveryId), enforce_nonce: true })
  }, 10_000).catch(() => null);
  const result = await response?.json().catch(() => null);
  if (!response?.ok || !result?.id) {
    return NextResponse.json({ error: "Discord delivery failed", upstream_status: response?.status ?? null }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message_id: result.id, channel_id: channelId });
}
