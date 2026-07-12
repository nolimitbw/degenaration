import { NextRequest, NextResponse } from "next/server";
import { fetchWithTimeout, rateLimit } from "@/lib/server/guard";
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

async function directListChannels() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false as const, error: "service key fallback unavailable" };
  const query = new URL(`${url}/rest/v1/call_channels`);
  query.searchParams.set("select", "id,guild_name,channel_name,channel_id,registered_by,guild_member_count,status,group_id,created_at");
  query.searchParams.set("order", "created_at.desc");
  const response = await fetchWithTimeout(query.toString(), {
    headers: { apikey: key, authorization: `Bearer ${key}` }
  }).catch(() => null);
  if (!response) return { ok: false as const, error: "direct channel query failed" };
  const data = await response.json().catch(() => null);
  if (!response.ok) return { ok: false as const, error: `direct channel query rejected (${response.status})` };
  return { ok: true as const, channels: normalizeChannels(data) };
}

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const result = await callAdminRpc<unknown>("admin_list_call_channels", {});
  if (!result.ok) {
    const fallback = await directListChannels();
    if (fallback.ok) {
      return NextResponse.json(
        { channels: fallback.channels, source: "service-role-fallback", rpcError: result.error },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }
    return NextResponse.json({ error: result.error, fallbackError: fallback.error }, { status: result.status });
  }

  const channels = normalizeChannels(result.data);
  if (!channels.length) {
    const fallback = await directListChannels();
    if (fallback.ok && fallback.channels.length) {
      return NextResponse.json(
        { channels: fallback.channels, source: "service-role-fallback", rpcCount: 0 },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }
  }

  return NextResponse.json(
    { channels, source: "admin-rpc", normalizedFrom: Array.isArray(result.data) ? "array" : typeof result.data },
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
