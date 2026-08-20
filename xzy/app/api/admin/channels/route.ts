import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { db } from "@/lib/db/client";
import type { Channel } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Channel review.
 *
 * Approving a channel is what makes its posts start moving subscribers' money, so it is
 * gated on ADMIN_TELEGRAM_IDS — a numeric allowlist, never a username, and never a flag
 * carried in the request.
 */

const SELECT = "id,chat_id,title,username,status,member_count,listed_by_tg_id,listed_at,approved_at,calls_measured";

export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  if (!auth.isAdmin) return NextResponse.json({ error: "not an admin" }, { status: 403 });

  const rows = await db<Channel[]>(`channels?select=${SELECT}&order=listed_at.desc&limit=200`);
  if (!rows) return NextResponse.json({ error: "channel list unavailable" }, { status: 503 });

  return NextResponse.json({
    channels: rows.map((row) => ({
      id: row.id,
      chatId: row.chat_id,
      title: row.title,
      username: row.username,
      status: row.status,
      memberCount: row.member_count,
      listedByTgId: row.listed_by_tg_id,
      listedAt: row.listed_at,
      approvedAt: row.approved_at
    }))
  });
}

const ACTIONS = { approve: "approved", reject: "rejected", unlist: "removed" } as const;

export async function POST(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  if (!auth.isAdmin) return NextResponse.json({ error: "not an admin" }, { status: 403 });

  let body: { channelId?: string; action?: keyof typeof ACTIONS };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const status = body.action ? ACTIONS[body.action] : undefined;
  if (typeof body.channelId !== "string" || !status) {
    return NextResponse.json({ error: "Need a channelId and one of: approve, reject, unlist." }, { status: 400 });
  }

  const rows = await db<Channel[]>(`channels?id=eq.${encodeURIComponent(body.channelId)}`, {
    method: "PATCH",
    body: {
      status,
      // The schema requires an approval timestamp on an approved channel, so the audit
      // trail cannot be skipped.
      approved_at: status === "approved" ? new Date().toISOString() : null
    }
  });

  if (!rows?.length) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  return NextResponse.json({ ok: true, status });
}
