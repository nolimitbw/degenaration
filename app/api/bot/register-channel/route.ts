import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";

const cleanText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || null : null;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const secret = process.env.BOT_SHARED_SECRET;
  if (!secret || req.headers.get("x-bot-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const guildId = cleanText(body?.guild_id, 64);
  const channelId = cleanText(body?.channel_id, 64);
  if (!guildId || !channelId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const response = await fetchWithTimeout(`${SB}/rest/v1/rpc/bot_register_call_channel`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
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
  if (!response.ok) return NextResponse.json({ error: "registration failed", status: response.status }, { status: 502 });
  if (data?.ok === false) return NextResponse.json({ error: data.error || "registration failed" }, { status: data.status || 400 });
  return NextResponse.json(data ?? { ok: true });
}
