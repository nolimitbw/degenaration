import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";

const snowflake = /^\d{17,20}$/;
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}` });

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;
  const secret = process.env.BOT_SHARED_SECRET;
  if (!secret || req.headers.get("x-bot-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const guildId = req.nextUrl.searchParams.get("guild_id");
  if (!guildId || !snowflake.test(guildId)) return NextResponse.json({ error: "invalid guild" }, { status: 400 });
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const channelsUrl = new URL(`${url}/rest/v1/call_channels`);
  channelsUrl.searchParams.set("guild_id", `eq.${guildId}`);
  channelsUrl.searchParams.set("select", "channel_id,channel_name,status,group_id,created_at,approved_at");
  channelsUrl.searchParams.set("order", "created_at.desc");
  const channelResponse = await fetchWithTimeout(channelsUrl, { headers: headers(key), cache: "no-store" });
  if (!channelResponse.ok) return NextResponse.json({ error: "status query failed" }, { status: 502 });
  const channels: any[] = await channelResponse.json();
  const groupId = channels.find((channel) => channel.group_id)?.group_id ?? null;
  let profile: any = null;
  let topCallers: Array<{ name: string; calls: number }> = [];

  if (groupId) {
    const groupUrl = new URL(`${url}/rest/v1/approved_groups`);
    groupUrl.searchParams.set("id", `eq.${groupId}`);
    groupUrl.searchParams.set("select", "id,name,public_slug,referral_code");
    groupUrl.searchParams.set("limit", "1");
    const callsUrl = new URL(`${url}/rest/v1/calls`);
    callsUrl.searchParams.set("group_id", `eq.${groupId}`);
    callsUrl.searchParams.set("select", "caller");
    callsUrl.searchParams.set("limit", "1000");
    const [groupResponse, callsResponse] = await Promise.all([
      fetchWithTimeout(groupUrl, { headers: headers(key), cache: "no-store" }),
      fetchWithTimeout(callsUrl, { headers: headers(key), cache: "no-store" })
    ]);
    if (groupResponse.ok) profile = (await groupResponse.json())?.[0] ?? null;
    if (callsResponse.ok) {
      const counts = new Map<string, number>();
      for (const row of await callsResponse.json()) {
        const name = typeof row?.caller === "string" ? row.caller.trim().slice(0, 100) : "";
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      topCallers = [...counts.entries()].map(([name, calls]) => ({ name, calls })).sort((a, b) => b.calls - a.calls).slice(0, 10);
    }
  }

  return NextResponse.json({ channels, profile, topCallers }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
