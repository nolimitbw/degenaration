import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who the caller is, according to a freshly verified initData signature. */
export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  return NextResponse.json({
    id: auth.user.id,
    username: auth.user.username,
    firstName: auth.user.firstName,
    isAdmin: auth.isAdmin
  });
}
