import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, validBaseUnits, validSlippageBps, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";
import { getMintDecimals } from "@/lib/server/tokenMeta";

const JUP = "https://lite-api.jup.ag/swap/v1";
const PLATFORM_FEE_BPS = 200;
const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function GET(req: NextRequest) {
  const limited = rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (limited) return limited;

  const p = req.nextUrl.searchParams;
  const inputMint = p.get("in"), outputMint = p.get("out");
  if (!isMint(inputMint) || !isMint(outputMint)) return NextResponse.json({ error: "invalid mint(s)" }, { status: 400 });
  // base units: SOL input (buy) gets the fat-finger cap; token input (sell) allows u64.
  const amount = validBaseUnits(p.get("amount"), inputMint === SOL_MINT);
  if (amount == null) return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  const slippageBps = validSlippageBps(p.get("slippageBps"));
  const applyFee = Boolean(process.env.PLATFORM_FEE_ACCOUNT);

  try {
    const [inputDecimals, outputDecimals] = await Promise.all([
      getMintDecimals(inputMint),
      getMintDecimals(outputMint)
    ]);
    const url = new URL(`${JUP}/quote`);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("slippageBps", String(slippageBps));
    if (applyFee) url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    const q = await fetchWithTimeout(url, { cache: "no-store" }).then(r => r.json());
    if (q.error) return NextResponse.json({ error: q.error }, { status: 400 });
    return NextResponse.json({
      inAmount: q.inAmount, outAmount: q.outAmount, priceImpactPct: q.priceImpactPct,
      inputDecimals,
      outputDecimals,
      platformFeeBps: applyFee ? PLATFORM_FEE_BPS : 0,
      feeAccountSet: applyFee,
      route: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean)
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
