import { NextRequest, NextResponse } from "next/server";
import { distributedRateLimit } from "@/lib/server/distributed-rate-limit";
import { callAdminRpc, requireAdmin } from "@/lib/server/admin";
import { UUID_RE } from "@/lib/server/product";

export async function GET(req: NextRequest) {
  const limited = await distributedRateLimit(req, { limit: 60, windowSeconds: 60 });
  if (limited) return limited;
  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;
  if (admin.legacy) return NextResponse.json({ error: "verified owner session required" }, { status: 403 });

  const result = await callAdminRpc<any[]>("admin_list_server_applications", {});
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { applications: Array.isArray(result.data) ? result.data : [] },
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

  const result = await callAdminRpc("admin_decide_server_application_v2", {
    p_actor_privy_user_id: admin.privyUserId,
    p_id: body.id,
    p_action: body.action,
    p_reason: body.reason.slice(0, 500)
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
