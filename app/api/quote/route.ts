import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, validBaseUnits, validSlippageBps, fetchWithTimeout, sanitizeError } from "@/lib/server/guard";
import { getMintDecimals } from "@/lib/server/tokenMeta";
import { configuredPlatformFeeBps } from "@/lib/fee-model";
import { resolveSwapFeeAccount } from "@/lib/server/fee-account";

const JUP = "https://lite-api.jup.ag/swap/v1";
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
  try {
    // THE PREVIEW MUST USE THE SAME RESOLVER AS THE BUILD.
    //
    // This route reported `configuredPlatformFeeBps()`, which only tests that the environment
    // variable is non-empty. /api/swap uses `resolveFeeAccount()`, which additionally checks the
    // fee token account is initialised for a mint in THIS pair and applies 0 when it is not. In
    // production the configured value is a wallet whose associated wSOL account does not
    // exist, so the quote advertised 2.00% and the swap charged nothing.
    //
    // Quoting more than is charged is the safe direction, but the two halves disagreeing is the
    // defect: a fee preview that is not the fee logic is not a preview of anything.
    const [inputDecimals, outputDecimals, resolvedFee] = await Promise.all([
      getMintDecimals(inputMint),
      getMintDecimals(outputMint),
      resolveSwapFeeAccount(inputMint, outputMint)
    ]);
    const platformFeeBps = resolvedFee.feeAccount ? configuredPlatformFeeBps() : 0;
    const applyFee = platformFeeBps > 0;
    const url = new URL(`${JUP}/quote`);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("slippageBps", String(slippageBps));
    if (applyFee) url.searchParams.set("platformFeeBps", String(platformFeeBps));
    const q = await fetchWithTimeout(url, { cache: "no-store" }).then(r => r.json());
    if (q.error) return NextResponse.json({ error: q.error }, { status: 400 });
    return NextResponse.json({
      inAmount: q.inAmount, outAmount: q.outAmount, priceImpactPct: q.priceImpactPct,
      inputDecimals,
      outputDecimals,
      platformFeeBps,
      feeAccountSet: applyFee,
      route: (q.routePlan ?? []).map((r: any) => r.swapInfo?.label).filter(Boolean)
    });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeError(e) }, { status: 502 });
  }
}
