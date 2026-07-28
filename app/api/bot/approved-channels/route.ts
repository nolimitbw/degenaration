import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
import { botBridgeHeaders, getBotBridgeUrl } from "@/lib/server/bot-rpc";
import { isBotRequest } from "@/lib/server/bot-auth";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  if (!isBotRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const distributed = await distributedRateLimit(req, {
    limit: 120,
    windowSeconds: 60,
    scope: "discord:approved-channels",
    subject: "discord-bot",
    skipLocal: true
  });
  if (distributed) return distributed;

  const secret = process.env.BOT_SHARED_SECRET!;
  const bridgeUrl = getBotBridgeUrl();
  if (!bridgeUrl) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const response = await fetchWithTimeout(bridgeUrl, {
    method: "POST",
    headers: botBridgeHeaders,
    body: JSON.stringify({ operation: "approved_channels", p_secret: secret })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: "approved channel query failed", status: response.status }, { status: 502 });
  return NextResponse.json({ channels: Array.isArray(data) ? data : [] });
}
