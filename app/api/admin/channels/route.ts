import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { UUID_RE } from "@/lib/server/product";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Channel = {
  id: string;
  guild_name: string | null;
  channel_name: string | null;
  channel_id: string;
  registered_by: string | null;
  guild_member_count: number | null;
  status: string;
  group_id: string | null;
  created_at: string;
};

function normalizeChannels(data: unknown): Channel[] {
  if (Array.isArray(data)) return data as Channel[];
  if (data && typeof data === "object" && Array.isArray((data as any).channels)) return (data as any).channels as Channel[];
  return [];
}

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const result = await callAdminRpc<unknown>("admin_list_call_channels", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const channels = normalizeChannels(result.data);
  return NextResponse.json(
    { channels, source: "admin-rpc" },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: NextRequest) {
  const limited = await distributedRateLimit(req, {
    limit: 30,
    windowSeconds: 60,
    failClosed: true
  });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  let body: { id?: string; action?: string; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!UUID_RE.test(body.id || "") || !["approve", "reject"].includes(body.action || "") || typeof body.reason !== "string" || body.reason.trim().length < 3) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const result = await callAdminRpc("admin_decide_call_channel_v2", {
    p_actor_privy_user_id: admin.privyUserId,
    p_id: body.id,
    p_action: body.action,
    p_reason: body.reason.slice(0, 500)
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
