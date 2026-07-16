/**
 * Jupiter swap builder. The configured platform fee is applied only when
 * PLATFORM_FEE_ACCOUNT is present, matching the website preview APIs.
 * Docs: https://dev.jup.ag/docs/swap-api
 */
const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PLATFORM_FEE_BPS = 200;
// Auto-trades are UNATTENDED, so a catastrophic-impact fill (thin liquidity vs trade size)
// would rek the user before they could react. Reject it — matches the frontend /api/swap
// guard so manual and automated trades share the same protection.
const MAX_PRICE_IMPACT_PCT = 15;

// Only charge the platform fee when a destination account is actually configured.
// Jupiter rejects a swap whose quote requests platformFeeBps but supplies no feeAccount,
// so requesting the fee unconditionally would make EVERY worker trade fail when the env
// var is unset. Mirror the frontend /api/swap behaviour: fee is all-or-nothing per env.
const FEE_ACCOUNT = process.env.PLATFORM_FEE_ACCOUNT;
const APPLY_FEE = !!FEE_ACCOUNT;

function platformFeeSol(solAmount) {
  const amount = Number(solAmount);
  return APPLY_FEE && Number.isFinite(amount) && amount > 0
    ? amount * PLATFORM_FEE_BPS / 10_000
    : 0;
}

async function getQuote({ inputMint, outputMint, amountLamports, slippageBps }) {
  const url = new URL(`${JUP}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountLamports));
  url.searchParams.set("slippageBps", String(slippageBps));
  if (APPLY_FEE) url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
  const q = await fetch(url).then(r => r.json());
  if (q.error) throw new Error(`quote failed: ${q.error}`);
  const impact = Math.abs(Number(q.priceImpactPct));
  if (Number.isFinite(impact) && impact > MAX_PRICE_IMPACT_PCT) {
    throw new Error(`price impact ${impact.toFixed(1)}% exceeds ${MAX_PRICE_IMPACT_PCT}% limit`);
  }
  return q;
}

/** Build unsigned swap tx — signed by the USER's delegated session key, never by us. */
async function buildSwapTx({ quote, userPublicKey }) {
  const swapBody = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto"
  };
  if (APPLY_FEE) swapBody.feeAccount = FEE_ACCOUNT;
  const res = await fetch(`${JUP}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(swapBody)
  }).then(r => r.json());
  if (res.error) throw new Error(`swap build failed: ${res.error}`);
  return res.swapTransaction; // base64 unsigned tx
}

const buyToken = (mint, solAmount, userPublicKey, slippageBps = 300) =>
  getQuote({ inputMint: SOL_MINT, outputMint: mint, amountLamports: Math.floor(solAmount * 1e9), slippageBps })
    .then(quote => buildSwapTx({ quote, userPublicKey }).then(tx => ({ quote, tx })));

const sellToken = (mint, tokenAmountRaw, userPublicKey, slippageBps = 300) =>
  getQuote({ inputMint: mint, outputMint: SOL_MINT, amountLamports: tokenAmountRaw, slippageBps })
    .then(quote => buildSwapTx({ quote, userPublicKey }).then(tx => ({ quote, tx })));

module.exports = {
  getQuote, buildSwapTx, buyToken, sellToken, platformFeeSol,
  SOL_MINT, PLATFORM_FEE_BPS, APPLY_FEE
};
