/**
 * Jupiter swap builder. The configured platform fee is applied only when
 * PLATFORM_FEE_ACCOUNT is present, matching the website preview APIs.
 * Docs: https://dev.jup.ag/docs/swap-api
 */
const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
// Canonical rate lives in lib/fee-model.js. The worker deploys with rootDir: server
// (render.yaml), so lib/ is not present at runtime and cannot be imported here. The
// value is mirrored instead, and server/test/run.js fails if the two ever drift.
const PLATFORM_FEE_BPS = 200;
const LAMPORTS_PER_SOL = 1000000000;
// Auto-trades are UNATTENDED, so a catastrophic-impact fill (thin liquidity vs trade size)
// would rek the user before they could react. Reject it — matches the frontend /api/swap
// guard so manual and automated trades share the same protection.
const MAX_PRICE_IMPACT_PCT = 15;

// Only charge the platform fee when a destination account is actually configured.
// Jupiter rejects a swap whose quote requests platformFeeBps but supplies no feeAccount,
// so requesting the fee unconditionally would make EVERY worker trade fail when the env
// var is unset. Mirror the frontend /api/swap behaviour: fee is all-or-nothing per env.
const FEE_ACCOUNT = process.env.PLATFORM_FEE_ACCOUNT;

// Jupiter does NOT validate feeAccount. A wallet address pasted into PLATFORM_FEE_ACCOUNT
// builds a transaction successfully and then fails on chain at execution — which would
// break every worker trade, not merely forgo the fee.
//
// The worker deploys with rootDir: server (render.yaml) so it cannot import
// lib/server/fee-account.ts. It performs the same check with a one-time probe at startup
// and disables the fee if the account cannot receive one. Collecting nothing is
// recoverable; breaking every trade is not.
let APPLY_FEE = false;
let feeAccountChecked = false;

async function feeAccountUsable() {
  if (!FEE_ACCOUNT) return false;
  const rpc = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  try {
    const r = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo",
        params: [FEE_ACCOUNT, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(6000)
    });
    const value = (await r.json())?.result?.value;
    const usable = value?.data?.parsed?.type === "account";
    if (!usable) {
      console.warn(`[jupiter] platform fee DISABLED — PLATFORM_FEE_ACCOUNT ${FEE_ACCOUNT} is not an initialised token account`);
    }
    return usable;
  } catch {
    console.warn("[jupiter] platform fee DISABLED — could not verify PLATFORM_FEE_ACCOUNT");
    return false;
  }
}

async function ensureFeeAccountChecked() {
  if (feeAccountChecked) return APPLY_FEE;
  feeAccountChecked = true;
  APPLY_FEE = await feeAccountUsable();
  return APPLY_FEE;
}

/**
 * Test seam. The ledger-facing fee math must stay deterministic and offline, so tests set
 * the resolved state directly instead of reaching the network. Production never calls this
 * — the probe above settles APPLY_FEE before any trade records a fee, because every trade
 * goes through getQuote/buildSwapTx first.
 */
function __setFeeAccountUsable(usable) {
  APPLY_FEE = Boolean(usable);
  feeAccountChecked = true;
}

/** Exact integer fee on a lamport notional. This is the ledger-facing calculation. */
function platformFeeLamports(notionalLamports) {
  if (!APPLY_FEE) return BigInt(0);
  let lamports;
  try {
    lamports = typeof notionalLamports === "bigint" ? notionalLamports : BigInt(notionalLamports);
  } catch {
    return BigInt(0);
  }
  if (lamports <= BigInt(0)) return BigInt(0);
  return (lamports * BigInt(PLATFORM_FEE_BPS)) / BigInt(10000);
}

/**
 * SOL-denominated fee for display and existing callers. Computed through the exact
 * integer path above; do not reintroduce floating-point rate math here.
 */
function platformFeeSol(solAmount) {
  const amount = Number(solAmount);
  if (!APPLY_FEE || !Number.isFinite(amount) || amount <= 0) return 0;
  const fee = platformFeeLamports(BigInt(Math.round(amount * LAMPORTS_PER_SOL)));
  return Number(fee) / LAMPORTS_PER_SOL;
}

async function getQuote({ inputMint, outputMint, amountLamports, slippageBps }) {
  const url = new URL(`${JUP}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountLamports));
  url.searchParams.set("slippageBps", String(slippageBps));
  if (await ensureFeeAccountChecked()) url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`quote failed (${response.status})`);
  const q = await response.json();
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
  if (await ensureFeeAccountChecked()) swapBody.feeAccount = FEE_ACCOUNT;
  const res = await fetch(`${JUP}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(swapBody),
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`swap build failed (${res.status})`);
  const body = await res.json();
  if (body.error) throw new Error(`swap build failed: ${body.error}`);
  if (!body.swapTransaction) throw new Error("swap build returned no transaction");
  return body.swapTransaction; // base64 unsigned tx
}

const buyToken = (mint, solAmount, userPublicKey, slippageBps = 300) =>
  getQuote({ inputMint: SOL_MINT, outputMint: mint, amountLamports: Math.floor(solAmount * 1e9), slippageBps })
    .then(quote => buildSwapTx({ quote, userPublicKey }).then(tx => ({ quote, tx })));

const sellToken = (mint, tokenAmountRaw, userPublicKey, slippageBps = 300) =>
  getQuote({ inputMint: mint, outputMint: SOL_MINT, amountLamports: tokenAmountRaw, slippageBps })
    .then(quote => buildSwapTx({ quote, userPublicKey }).then(tx => ({ quote, tx })));

module.exports = {
  getQuote, buildSwapTx, buyToken, sellToken, platformFeeSol, platformFeeLamports,
  ensureFeeAccountChecked, __setFeeAccountUsable,
  SOL_MINT, PLATFORM_FEE_BPS,
  // APPLY_FEE is resolved asynchronously by the probe, so it is exposed as a getter
  // rather than a snapshot taken at module load (which was always false).
  get APPLY_FEE() { return APPLY_FEE; }
};
