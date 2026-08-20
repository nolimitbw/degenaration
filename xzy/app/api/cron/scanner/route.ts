import { NextResponse } from "next/server";
import { scannerTick } from "@/server/scanner";
import { createScannerDeps } from "@/server/trading-deps";
import { isScheduledRequest } from "@/lib/server/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One scoring pass: re-price recent calls and recompute channel track records.
 *
 * Slower-moving than the position monitor, so it runs on a longer schedule. Safe to
 * repeat — peaks only ever ratchet up.
 */
export async function POST(req: Request) {
  if (!isScheduledRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const outcome = await scannerTick(createScannerDeps());
  return NextResponse.json({ ok: true, ...outcome });
}

export const GET = POST;
