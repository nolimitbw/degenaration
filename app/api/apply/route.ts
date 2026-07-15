import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";

const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

function discordInvite(value: unknown) {
  const raw = text(value, 200);
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || !["discord.gg", "discord.com"].includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 5, windowMs: 60 * 60_000 });
  if (limited) return limited;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const serverName = text(body?.server_name, 100);
  const inviteLink = discordInvite(body?.invite_link);
  const ownerHandle = text(body?.owner_handle, 100);
  const memberCount = text(body?.member_count, 30) || null;
  const pitch = text(body?.pitch, 1000) || null;
  if (!serverName || !inviteLink || !ownerHandle) return NextResponse.json({ error: "invalid application" }, { status: 400 });

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return NextResponse.json({ error: "server not configured" }, { status: 503 });
  const response = await fetchWithTimeout(`${url}/rest/v1/server_applications`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ server_name: serverName, invite_link: inviteLink, owner_handle: ownerHandle, member_count: memberCount, pitch, status: "pending" })
  });
  if (!response.ok) return NextResponse.json({ error: "application could not be saved" }, { status: 502 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
