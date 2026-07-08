import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";

/**
 * Owner-only management of Discord call channels (service-role table, so it must go through
 * the server key). Gated by the SERVER-ONLY admin key: header `x-admin-key` must match the
 * ADMIN_KEY env var. Never accept a NEXT_PUBLIC_ value here — it ships in the client bundle,
 * so anyone could read it and approve their own (scam) channel. Approving a channel
 * links/creates its group so the bot starts forwarding its calls.
 */
function sb() {
  const SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY) return null;
  const H = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };
  return { SB, H };
}

function authed(req: NextRequest) {
  const expected = process.env.ADMIN_KEY; // server-only; NEVER a NEXT_PUBLIC_ value
  return !!expected && req.headers.get("x-admin-key") === expected;
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = sb();
  if (!s) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const rows = await fetch(`${s.SB}/rest/v1/call_channels?select=*&order=created_at.desc`, { headers: s.H }).then((r) => r.json()).catch(() => []);
  return NextResponse.json({ channels: Array.isArray(rows) ? rows : [] });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = sb();
  if (!s) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { id, action } = body ?? {};
  if (!id || !["approve", "reject"].includes(action)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  if (action === "reject") {
    await fetch(`${s.SB}/rest/v1/call_channels?id=eq.${id}`, { method: "PATCH", headers: { ...s.H, prefer: "return=minimal" }, body: JSON.stringify({ status: "rejected" }) });
    return NextResponse.json({ ok: true });
  }

  // approve: ensure the channel has a group, creating one from the guild name if needed.
  const rows = await fetch(`${s.SB}/rest/v1/call_channels?id=eq.${id}&select=id,guild_name,group_id`, { headers: s.H }).then((r) => r.json()).catch(() => []);
  const ch = Array.isArray(rows) ? rows[0] : null;
  if (!ch) return NextResponse.json({ error: "not found" }, { status: 404 });

  let groupId = ch.group_id;
  if (!groupId) {
    const created = await fetch(`${s.SB}/rest/v1/approved_groups`, {
      method: "POST", headers: { ...s.H, prefer: "return=representation" },
      body: JSON.stringify({ name: ch.guild_name || "Discord server", tag: "Discord", active: true })
    }).then((r) => r.json()).catch(() => null);
    groupId = Array.isArray(created) ? created[0]?.id : null;
  }
  await fetch(`${s.SB}/rest/v1/call_channels?id=eq.${id}`, { method: "PATCH", headers: { ...s.H, prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", group_id: groupId }) });
  return NextResponse.json({ ok: true, group_id: groupId });
}
