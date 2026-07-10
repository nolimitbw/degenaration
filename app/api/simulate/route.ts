import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, validAmount, validSlippageBps, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";

const JUP = "https://lite-api.jup.ag/swap/v1";
const PLATFORM_FEE_BPS = 200;
const SOL_MINT = "So11111111111111111111111111111111111111112";

// GET /api/simulate?in=&out=&amount=&slippageBps= -> trade preview (out, impact, fee, min received)
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
    url.searchParams.set("inputMint", inputMint); url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", String(amount)); url.searchParams.set("slippageBps", String(slippageBps));
    url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    const q = await fetchWithTimeout(url, { cache: "no-store" }).then((r) => r.json());
    if (q.error) return NextResponse.json({ error: q.error }, { status: 400 });
    const out = q.outAmount != null ? Number(q.outAmount) : 0;
    const impact = q.priceImpactPct != null ? Math.abs(Number(q.priceImpactPct)) : 0;
    const inputDecimals = inputMint === SOL_MINT ? 9 : 6;
    const feeSol = (amount / 10 ** inputDecimals) * (PLATFORM_FEE_BPS / 10000);
    const minReceived = q.otherAmountThreshold ? Number(q.otherAmountThreshold) : (out > 0 ? Math.floor(out * (1 - slippageBps / 10000)) : 0);
    return NextResponse.json({
      inAmountSol: amount / 1e9, outAmount: out, minReceived,
      priceImpactPct: impact, platformFeeBps: PLATFORM_FEE_BPS, feeSol,
      slippageBps, route: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean),
      warn: impact > 10 ? "High price impact — low liquidity" : null
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
