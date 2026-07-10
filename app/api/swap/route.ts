import { NextRequest, NextResponse } from "next/server";
import { rateLimit, isMint, validBaseUnits, validSlippageBps } from "@/lib/server/guard";

const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PLATFORM_FEE_BPS = 200;
const MAX_PRICE_IMPACT_PCT = 15; // reject swaps with insane price impact

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, { limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  // No auth gate here on purpose: this only builds an UNSIGNED swap tx for the caller's
  // own pubkey, which they must sign with their own wallet. It moves no funds and leaks no
  // data. Requiring a Supabase token here wrongly blocked Privy/Google users (who have an
  // embedded wallet but no Supabase session) from trading. Rate limiting guards abuse.
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const { inputMint, outputMint, userPublicKey, mev } = body ?? {};
  if (!isMint(inputMint) || !isMint(outputMint)) return NextResponse.json({ error: "invalid mint(s)" }, { status: 400 });
  if (!isMint(userPublicKey)) return NextResponse.json({ error: "invalid userPublicKey" }, { status: 400 });
  // amount is in the INPUT token's base units. Buys (SOL input) get the 100-SOL fat-finger
  // cap; token sells are bounded only by u64 so a large position can be fully exited.
  const amount = validBaseUnits(body.amount, inputMint === SOL_MINT);
  if (amount == null) return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  const slippageBps = validSlippageBps(body.slippageBps);
  const mevEnabled = mev !== false;

  const feeAccount = process.env.PLATFORM_FEE_ACCOUNT;
  const applyFee = !!feeAccount;

  try {
    const qurl = new URL(`${JUP}/quote`);
    qurl.searchParams.set("inputMint", inputMint);
    qurl.searchParams.set("outputMint", outputMint);
    qurl.searchParams.set("amount", String(amount));
    qurl.searchParams.set("slippageBps", String(slippageBps));
    if (applyFee) qurl.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
    const quote = await fetch(qurl, { cache: "no-store" }).then((r) => r.json());
    if (quote.error) return NextResponse.json({ error: quote.error }, { status: 400 });

    // reject extreme price impact before building the tx
    const impact = Math.abs(Number(quote.priceImpactPct));
    if (Number.isFinite(impact) && impact > MAX_PRICE_IMPACT_PCT) {
      return NextResponse.json({ error: `price impact ${impact.toFixed(1)}% exceeds ${MAX_PRICE_IMPACT_PCT}% limit` }, { status: 400 });
    }

    const swapBody: any = {
      quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: mevEnabled, prioritizationFeeLamports: mevEnabled ? "auto" : undefined
    };
    if (applyFee) swapBody.feeAccount = feeAccount;

    const swap = await fetch(`${JUP}/swap`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(swapBody)
    }).then((r) => r.json());
    if (swap.error) return NextResponse.json({ error: swap.error }, { status: 400 });

    return NextResponse.json({
      swapTransaction: swap.swapTransaction, outAmount: quote.outAmount,
      priceImpactPct: quote.priceImpactPct, platformFeeBps: applyFee ? PLATFORM_FEE_BPS : 0, feeAccountSet: applyFee
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
