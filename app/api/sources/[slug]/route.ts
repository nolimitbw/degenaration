import { NextRequest, NextResponse } from "next/server";
import { getPublicSource } from "@/lib/publicSource";
import { rateLimit } from "@/lib/server/guard";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const limited = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const source = await getPublicSource((await params).slug);
  if (!source) return NextResponse.json({ error: "source not found" }, { status: 404 });
  return NextResponse.json(source, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
