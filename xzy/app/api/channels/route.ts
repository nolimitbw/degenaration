import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { db } from "@/lib/db/client";
import { isConfigured } from "@/lib/env";
import type { Channel } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The channel marketplace.
 *
 * Only approved channels are listed, and each carries its verified call count — the
 * number of calls we recorded ourselves from that channel's posts. A channel's own
 * claims about its record are never surfaced here; if we have not measured it, it
 * shows as unmeasured rather than as zero or as a guess.
 */
export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  if (!isConfigured()) {
    return NextResponse.json({ channels: [], configured: false });
  }

  const rows = await db<Channel[]>(
    "channels?status=eq.approved&select=id,chat_id,title,username,member_count,approved_at&order=approved_at.desc&limit=100"
  );

  if (rows === null) {
    return NextResponse.json({ error: "channel list unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    configured: true,
    channels: rows.map((row) => ({
      id: row.id,
      title: row.title,
      username: row.username,
      memberCount: row.member_count,
      approvedAt: row.approved_at
    }))
  });
}
