import { NextRequest, NextResponse } from "next/server";
import { getSourceSlugByReferral } from "@/lib/publicSource";
import { rateLimit } from "@/lib/server/guard";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const code = (await params).code.toLowerCase();
  const slug = await getSourceSlugByReferral(code);
  if (!slug) return NextResponse.json({ error: "referral not found" }, { status: 404 });
  return NextResponse.redirect(new URL(`/source/${slug}?ref=${encodeURIComponent(code)}`, req.url), 307);
}
