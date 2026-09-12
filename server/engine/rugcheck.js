/**
 * Token evidence for an auto-buy. It GATHERS; it does not refuse.
 *
 * WHAT CHANGED, AND WHY
 *
 * This file used to be a platform veto that ran before every buy and blocked on: liquidity
 * under $10,000, a rugcheck.xyz score over 60, a live mint or freeze authority, and — fail
 * closed — any case where those could not be read at all.
 *
 * It rejected every call the product ever received. 2,309 calls ingested, 2,309 marked
 * executed, 0 trades. The owner's own channel posts pump.fun tokens at $1,700-$3,300 of
 * liquidity; the floor was $10,000, so nothing could pass, and re-checking those mints days
 * later still put them at $1,859-$3,252. Not "rarely passed" — could not pass.
 *
 * The owner's decision, and it is the right one for this product: "just trade what the discord
 * calls sent to the channel, no guards or safety, because before people copy those discord
 * server they already know what they risking." A platform floor is a strategy opinion, and the
 * person choosing which caller to copy has already made it.
 *
 * WHAT STILL APPLIES, because none of it is a platform opinion:
 *   - the subscriber's OWN configured filters, when they turn any on (evaluateSafety below)
 *   - their capital limits, daily caps and trade count, enforced in worker_claim_call_execution
 *   - slippage, price impact and simulation, which protect the transaction rather than judge
 *     the token — a swap that cannot route or cannot be simulated still fails on its own
 *
 * So a call is now refused only by something its owner configured, or by the chain itself.
 */
const { evaluateSafety } = require("./safety");

const PROVIDER_TIMEOUT_MS = 8_000;

/**
 * Best-effort market and mint facts. Every provider is optional: a timeout yields null rather
 * than a rejection.
 *
 * This matters more than it looks. The old gate turned a provider timeout into "unsafe", and
 * the caller then marked the call permanently executed — so a network blip consumed a call
 * exactly as a rug would. Evidence that could not be fetched is now simply absent, and only a
 * filter the SUBSCRIBER enabled can fail closed on it.
 */
async function gatherEvidence(mint) {
  const [ds, acct] = await Promise.all([
    fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
      .then((r) => r.json()).catch(() => null),
    fetch(process.env.MAINNET_RPC || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    }).then((r) => r.json()).catch(() => null)
  ]);

  const pair = ds?.pairs?.slice().sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
  const mintInfo = acct?.result?.value?.data?.parsed?.info || null;
  return { pair, mintInfo };
}

/**
 * @param {string} mint
 * @param {object} [safety] the SUBSCRIBER's own safetyFilters { ranges, flags,
 *   unavailableDataBehavior }. Absent means no filters, which now means nothing to refuse:
 *   the platform contributes no reasons of its own.
 */
async function rugCheck(mint, safety) {
  const { pair, mintInfo } = await gatherEvidence(mint);

  let configured = null;
  const reasons = [];
  if (safety && (safety.ranges || safety.flags)) {
    configured = evaluateSafety({ mint, pair, mintInfo, safety, nowMs: Date.now() });
    reasons.push(...configured.reasons);
  }

  return {
    // ok is now decided ONLY by filters the subscriber configured.
    ok: reasons.length === 0,
    reasons,
    pair: pair ? { dex: pair.dexId, priceUsd: pair.priceUsd, liqUsd: pair.liquidity?.usd } : null,
    // Raw evidence, so the caller can evaluate EACH subscriber's own filters without another
    // network round trip per subscriber.
    evidence: { pair, mintInfo },
    evaluatedFilters: configured ? configured.evaluated : [],
    blockedUnevaluatedFilters: configured ? configured.blockedUnevaluated : []
  };
}

module.exports = { rugCheck, gatherEvidence };
