import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/guard";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const result = await callAdminRpc<any[]>("admin_list_server_applications", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ applications: Array.isArray(result.data) ? result.data : [] });
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

  const result = await callAdminRpc("admin_decide_server_application", { p_id: body.id, p_action: body.action });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data);
}
