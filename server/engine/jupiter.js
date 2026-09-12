/**
 * Jupiter swap builder. The configured platform fee is applied only when
 * PLATFORM_FEE_ACCOUNT is present, matching the website preview APIs.
 * Docs: https://dev.jup.ag/docs/swap-api
 */
const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const { PublicKey } = require("@solana/web3.js");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
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
// Jupiter Metis ExactIn accepts a fee account for either mint in the quoted pair. The product
// trades SOL pairs, so one initialized wSOL account safely covers both buys and sells. We still
// verify the account mint before quoting because Jupiter does not validate feeAccount itself.
let FEE_ACCOUNT_MINT = null;
let RESOLVED_FEE_ACCOUNT = null;

function associatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0].toBase58();
}

async function feeAccountUsable(feeMint = SOL_MINT) {
  if (!FEE_ACCOUNT) return false;
  const rpc = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
  try {
    const accountInfo = async (address) => {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo",
          params: [address, { encoding: "jsonParsed" }] }),
        signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) return null;
      return (await r.json())?.result?.value || null;
    };

    const configured = await accountInfo(FEE_ACCOUNT);
    const parsed = configured?.data?.parsed;
    if (parsed?.type === "account") {
      if (parsed?.info?.mint !== feeMint) {
        console.warn(`[jupiter] platform fee DISABLED — configured token account holds ${parsed?.info?.mint}, expected ${feeMint}`);
        return false;
      }
      RESOLVED_FEE_ACCOUNT = FEE_ACCOUNT;
      FEE_ACCOUNT_MINT = feeMint;
      console.info(`[jupiter] platform fee enabled for ${feeMint}`);
      return true;
    }

    const derived = associatedTokenAddress(new PublicKey(FEE_ACCOUNT), new PublicKey(feeMint));
    const value = await accountInfo(derived);
    const derivedParsed = value?.data?.parsed;
    const usable = derivedParsed?.type === "account" && derivedParsed?.info?.mint === feeMint;
    if (!usable) {
      console.warn(`[jupiter] platform fee DISABLED — no initialized ${feeMint} account for ${FEE_ACCOUNT}`);
      return false;
    }
    RESOLVED_FEE_ACCOUNT = derived;
    FEE_ACCOUNT_MINT = feeMint;
    console.info(`[jupiter] platform fee enabled for pair mint ${FEE_ACCOUNT_MINT}`);
    return true;
  } catch {
    console.warn("[jupiter] platform fee DISABLED — could not verify PLATFORM_FEE_ACCOUNT");
    return false;
  }
}

/**
 * The fee may only be requested when the verified fee mint is this ExactIn swap's OUTPUT.
 *
 * On an ExactIn swap Jupiter takes the platform fee in the OUTPUT mint, so the feeAccount must
 * be an associated token account OF THAT MINT. Accepting `inputMint === FEE_ACCOUNT_MINT` as
 * well made every BUY request a fee: input wSOL matched, so we sent platformFeeBps together
 * with the wSOL fee account while Jupiter intended to take the fee in the memecoin being
 * bought. The program rejected the mismatch with custom error 0x177e (6014) at simulation, so
 * EVERY buy failed and no position was ever opened.
 *
 * This is not fixable by creating fee accounts: the output mint of a buy is whatever token was
 * just called, so its ATA cannot exist in advance. Charging on the sell leg is the only
 * coverable side, which is why the fee wallet needs wSOL — "wSOL first (covers every sell)".
 *
 * Proven against mainnet before the change: the identical quote and swap simulate clean
 * (err: null) with no platformFeeBps, and Jupiter reports platformFee.feeMint as the memecoin
 * when one is requested.
 *
 * Net effect: 200 bps on every confirmed SELL leg, nothing on the buy.
 */
function feeAppliesToPair(inputMint, outputMint) {
  void inputMint;
  return APPLY_FEE && Boolean(FEE_ACCOUNT_MINT) && outputMint === FEE_ACCOUNT_MINT;
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
function __setFeeAccountUsable(usable, mint) {
  APPLY_FEE = Boolean(usable);
  // Default to wSOL so existing callers keep the sell-side behaviour they assert on.
  FEE_ACCOUNT_MINT = usable ? (mint || SOL_MINT) : null;
  RESOLVED_FEE_ACCOUNT = usable ? FEE_ACCOUNT : null;
  feeAccountChecked = true;
}

function feeAccountReady() {
  return APPLY_FEE && Boolean(RESOLVED_FEE_ACCOUNT) && Boolean(FEE_ACCOUNT_MINT);
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
  const fee = platformFeeLamports(BigInt(solToLamports(amount)));
  return Number(fee) / LAMPORTS_PER_SOL;
}

/**
 * The bot's priority-fee policy, as Jupiter's swap API expects it.
 *
 * `prioritizationFeeLamports: "auto"` was hard-coded, so `priorityFeeStrategy` and
 * `priorityFeeMaxLamports` were collected, range-validated on save, reloaded into the editor —
 * and could not affect what a submission paid. Jupiter accepts a cap and a level instead, which
 * is exactly what the two controls mean.
 *
 * An absent or non-positive cap falls back to "auto", because a cap of zero means "the owner
 * never set one", not "pay nothing" — and paying nothing is a transaction that never lands.
 */
const PRIORITY_LEVELS = { economy: "low", auto: "medium", fast: "high" };

function prioritizationFee(execution) {
  // `= {}` is not enough: a default only fires for `undefined`, and the callers pass through a
  // resolver that returns NULL for "nothing configured". Destructuring that throws, which would
  // take down the submission for the most ordinary case there is.
  const { priorityFeeMaxLamports, priorityFeeStrategy } = execution || {};
  const maxLamports = Math.floor(Number(priorityFeeMaxLamports));
  if (!Number.isFinite(maxLamports) || maxLamports <= 0) return "auto";
  return {
    priorityLevelWithMaxLamports: {
      maxLamports,
      priorityLevel: PRIORITY_LEVELS[priorityFeeStrategy] || PRIORITY_LEVELS.auto
    }
  };
}

/**
 * Whether a quote is still fresh enough to submit.
 *
 * `quoteExpirationSeconds` had no reader: the engine applied its own window and a bot
 * configured for 10 seconds submitted a quote it had held for a minute. Zero or absent means
 * unset, and falls back to the engine's default rather than expiring everything instantly.
 */
const DEFAULT_QUOTE_TTL_SECONDS = 30;

function quoteExpired(args) {
  const { quotedAtMs, nowMs, quoteExpirationSeconds } = args || {};
  if (!Number.isFinite(quotedAtMs) || !Number.isFinite(nowMs)) return false;
  const configured = Math.floor(Number(quoteExpirationSeconds));
  const ttl = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUOTE_TTL_SECONDS;
  return nowMs - quotedAtMs > ttl * 1000;
}

async function getQuote({ inputMint, outputMint, amountLamports, slippageBps }) {
  const url = new URL(`${JUP}/quote`);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amountLamports));
  url.searchParams.set("slippageBps", String(slippageBps));
  await ensureFeeAccountChecked();
  if (feeAppliesToPair(inputMint, outputMint)) url.searchParams.set("platformFeeBps", String(PLATFORM_FEE_BPS));
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
async function buildSwapTx({ quote, userPublicKey, execution }) {
  // Mirror the quote decision exactly. Requesting platformFeeBps without feeAccount (or the
  // reverse) makes Jupiter reject the build, so both calls must agree on the same mint.
  const inputMint = quote?.inputMint;
  const outputMint = quote?.outputMint;
  const swapBody = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: prioritizationFee(execution)
  };
  await ensureFeeAccountChecked();
  if (feeAppliesToPair(inputMint, outputMint)) swapBody.feeAccount = RESOLVED_FEE_ACCOUNT;
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

/**
 * SOL to lamports, rounded to nearest — not floored.
 *
 * `size_sol` is a numeric column that PostgREST hands over as a JSON number, so the exact
 * decimal is a double before this code ever sees it. `1.001 * 1e9` is 1000999999.9999999, and
 * flooring that buys 1.000999999 SOL for a user who configured 1.001. Rounding recovers the
 * value they actually set. Measured, not assumed: across every 0.001 step from 0.001 to 10
 * SOL the two forms differ on 271 values, and the count is pinned by a test so a change in
 * double rounding is noticed rather than silently altering how much every bot buys.
 *
 * This also existed in two forms: `Math.floor` here and `Math.round` in platformFeeSol, for
 * the identical conversion. One helper, one rule.
 *
 * The residual lamport is unavoidable at this boundary and is not the ledger's problem: every
 * ledger-facing amount is integer BigInt from platformFeeLamports onward, and the executed
 * notional comes back from the chain rather than from this multiplication.
 */
function solToLamports(solAmount) {
  const amount = Number(solAmount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * LAMPORTS_PER_SOL);
}

/**
 * `execution` carries the bot's own priority-fee policy and quote freshness window, resolved
 * from the subscriber's immutable configuration snapshot. Omitted, both fall back to the engine
 * defaults, which is what a legacy subscription with no builder configuration gets.
 *
 * `quotedAtMs` is returned rather than checked here: the caller submits, so the caller is the
 * only place that knows how long the quote was actually held.
 */
const buyToken = (mint, solAmount, userPublicKey, slippageBps = 300, execution = null) =>
  getQuote({ inputMint: SOL_MINT, outputMint: mint, amountLamports: solToLamports(solAmount), slippageBps })
    .then(quote => buildSwapTx({ quote, userPublicKey, execution })
      .then(tx => ({ quote, tx, quotedAtMs: Date.now() })));

const sellToken = (mint, tokenAmountRaw, userPublicKey, slippageBps = 300, execution = null) =>
  getQuote({ inputMint: mint, outputMint: SOL_MINT, amountLamports: tokenAmountRaw, slippageBps })
    .then(quote => buildSwapTx({ quote, userPublicKey, execution })
      .then(tx => ({ quote, tx, quotedAtMs: Date.now() })));

module.exports = {
  getQuote, buildSwapTx, buyToken, sellToken, platformFeeSol, platformFeeLamports, solToLamports,
  prioritizationFee, quoteExpired, PRIORITY_LEVELS, DEFAULT_QUOTE_TTL_SECONDS,
  ensureFeeAccountChecked, __setFeeAccountUsable, feeAppliesToPair, feeAccountReady,
  SOL_MINT, PLATFORM_FEE_BPS,
  // APPLY_FEE is resolved asynchronously by the probe, so it is exposed as a getter
  // rather than a snapshot taken at module load (which was always false).
  get APPLY_FEE() { return APPLY_FEE; }
};
