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

  // Ordered by measured performance, with unmeasured channels last — a channel with no
  // track record should not outrank one that has earned a place.
  const rows = await db<(Channel & { median_peak_x: string | null; avg_peak_x: string | null })[]>(
    "channels?status=eq.approved&select=id,chat_id,title,username,member_count,approved_at,calls_measured,wins,avg_peak_x,median_peak_x,best_peak_x,stats_updated_at" +
      "&order=median_peak_x.desc.nullslast,approved_at.desc&limit=100"
  );

  if (rows === null) {
    return NextResponse.json({ error: "channel list unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    configured: true,
    channels: rows.map((row) => {
      const measured = Number(row.calls_measured ?? 0);
      const numeric = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      };
      return {
        id: row.id,
        title: row.title,
        username: row.username,
        memberCount: row.member_count,
        approvedAt: row.approved_at,
        // Null everywhere when nothing is measured. The UI renders that as "not measured
        // yet"; rendering it as 0% would read as a track record of total failure.
        callsMeasured: measured,
        winRatePct: measured > 0 ? (Number(row.wins ?? 0) / measured) * 100 : null,
        medianPeakX: numeric(row.median_peak_x),
        avgPeakX: numeric(row.avg_peak_x),
        bestPeakX: numeric(row.best_peak_x)
      };
    })
  });
}
