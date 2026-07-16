import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callAppBridge } from "@/lib/server/app-bridge";

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

  const result = await callAppBridge("app_submit_server_application", {
    p_server_name: serverName,
    p_invite_link: inviteLink,
    p_owner_handle: ownerHandle,
    p_member_count: memberCount,
    p_pitch: pitch
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}
