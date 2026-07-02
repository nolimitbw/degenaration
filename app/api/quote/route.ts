import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, validAmount, validSlippageBps } from "@/lib/server/guard";

const JUP = "https://lite-api.jup.ag/swap/v1";
const PLATFORM_FEE_BPS = 200;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const inputMint = p.get("in"), outputMint = p.get("out");
  if (!isMint(inputMint) || !isMint(outputMint)) return NextResponse.json({ error: "invalid mint(s)" }, { status: 400 });
  const amount = validAmount(p.get("amount"));
  if (amount == null) return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  const slippageBps = validSlippageBps(p.get("slippageBps"));

  try {
    const url = new URL(`${JUP}/quote`);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("slippageBps", String(slippageBps));
    url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    const q = await fetch(url, { cache: "no-store" }).then(r => r.json());
    if (q.error) return NextResponse.json({ error: q.error }, { status: 400 });
    return NextResponse.json({
      inAmount: q.inAmount, outAmount: q.outAmount, priceImpactPct: q.priceImpactPct,
      platformFeeBps: PLATFORM_FEE_BPS, route: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
