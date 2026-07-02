/**
 * Jupiter swap builder — THE 2% FEE LIVES HERE.
 * platformFeeBps = 200 → 2% taken on-chain on every swap (in AND out,
 * including partial TP/SL sells). Fee lands in PLATFORM_FEE_ACCOUNT.
 * Docs: https://dev.jup.ag/docs/swap-api
 */
const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const PLATFORM_FEE_BPS = 200; // 2%

async function getQuote({ inputMint, outputMint, amountLamports, slippageBps }) {
  const url = new URL(`${JUP}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountLamports));
  url.searchParams.set("slippageBps", String(slippageBps));
  url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
  const q = await fetch(url).then(r => r.json());
  if (q.error) throw new Error(`quote failed: ${q.error}`);
  return q;
}

/** Build unsigned swap tx — signed by the USER's delegated session key, never by us. */
async function buildSwapTx({ quote, userPublicKey }) {
  const res = await fetch(`${JUP}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      feeAccount: process.env.PLATFORM_FEE_ACCOUNT, // our 2% destination
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto"
    })
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

module.exports = { getQuote, buildSwapTx, buyToken, sellToken, SOL_MINT, PLATFORM_FEE_BPS };
