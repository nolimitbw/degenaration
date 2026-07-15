import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const secret = process.env.BOT_SHARED_SECRET;
  if (!secret || req.headers.get("x-bot-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const SB = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY) return NextResponse.json({ error: "server not configured" }, { status: 503 });

  const response = await fetchWithTimeout(`${SB}/rest/v1/rpc/bot_approved_call_channels`, {
    method: "POST",
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ p_secret: secret })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: "approved channel query failed", status: response.status }, { status: 502 });
  return NextResponse.json({ channels: Array.isArray(data) ? data : [] });
}
