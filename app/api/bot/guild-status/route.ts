import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";

const snowflake = /^\d{17,20}$/;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const secret = process.env.BOT_SHARED_SECRET;
  if (!secret || req.headers.get("x-bot-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const guildId = req.nextUrl.searchParams.get("guild_id");
  if (!guildId || !snowflake.test(guildId)) return NextResponse.json({ error: "invalid guild" }, { status: 400 });
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
