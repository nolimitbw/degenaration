import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, fetchWithTimeout } from "@/lib/server/guard";

/**
 * POST /api/ingest-call  — the Discord bot posts detected calls here.
 * Auth: header `x-bot-secret` must equal BOT_SHARED_SECRET.
 * Flow: verify the channel is an APPROVED call channel -> record the call (dedup by
 * messageId) -> the 24/7 worker then mirrors it to that group's subscribers.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (server-only) to write past RLS.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
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
  const { channelId, mint, raw, messageId } = body ?? {};
  if (!channelId || typeof channelId !== "string") return NextResponse.json({ error: "channelId required" }, { status: 400 });
  if (!isMint(mint)) return NextResponse.json({ error: "invalid mint" }, { status: 400 });

  const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

  // 1. Channel must be an approved call channel.
  const chans = await fetchWithTimeout(`${SB}/rest/v1/call_channels?channel_id=eq.${encodeURIComponent(channelId)}&status=eq.approved&select=group_id,guild_name`, { headers: H }).then((r) => r.json()).catch(() => null);
  const chan = Array.isArray(chans) ? chans[0] : null;
  if (!chan) return NextResponse.json({ error: "channel not approved" }, { status: 403 });

  // 2. Resolve the group name (for the leaderboard) + enrich with live price data.
  let groupName: string | null = chan.guild_name ?? null;
  if (chan.group_id) {
    const g = await fetchWithTimeout(`${SB}/rest/v1/approved_groups?id=eq.${chan.group_id}&select=name`, { headers: H }).then((r) => r.json()).catch(() => null);
    if (Array.isArray(g) && g[0]?.name) groupName = g[0].name;
  }
  let symbol: string | null = null, calledMcap: number | null = null;
  try {
    const px = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { cache: "no-store" }).then((r) => r.json());
    const pair = (px?.pairs ?? []).sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (pair) { symbol = pair.baseToken?.symbol ?? null; calledMcap = pair.fdv ?? pair.marketCap ?? null; }
  } catch { /* enrichment is best-effort */ }

  // 3. Record the call (dedup on message_id via unique index -> ignore duplicates).
  try {
    const res = await fetchWithTimeout(`${SB}/rest/v1/calls`, {
      method: "POST",
      headers: { ...H, prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ group_id: chan.group_id, group_name: groupName, mint, symbol, called_mcap: calledMcap, message_id: messageId ?? null, raw: (raw ?? "").slice(0, 500) })
    });
    if (!res.ok && res.status !== 409) {
      return NextResponse.json({ error: "record failed", status: res.status }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ error: "record failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, group: groupName, mint, symbol });
}
