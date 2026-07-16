import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

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
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const result = await callAdminRpc<unknown>("admin_list_call_channels", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const channels = normalizeChannels(result.data);
  return NextResponse.json(
    { channels, source: "admin-rpc" },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  let body: { id?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!body.id || !["approve", "reject"].includes(body.action || "")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const result = await callAdminRpc("admin_decide_call_channel", { p_id: body.id, p_action: body.action });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
