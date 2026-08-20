import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { monitorTick } from "@/server/monitor";
import { createMonitorDeps } from "@/server/trading-deps";
import { optionalEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One monitor pass over every open position, checking take-profit and stop-loss.
 *
 * Driven by an external scheduler (Vercel Cron, GitHub Actions, or any timer that can
 * make an authenticated request). Each tick is independent and safe to repeat, so a
 * missed or doubled run costs latency rather than correctness.
 */
function authorized(req: Request): boolean {
  const secret = optionalEnv("CRON_SECRET");
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const outcome = await monitorTick(createMonitorDeps());
  return NextResponse.json({ ok: true, ...outcome });
}

// Vercel Cron issues GET requests, so both verbs run the same tick.
export const GET = POST;
