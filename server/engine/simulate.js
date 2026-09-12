/**
 * Run the transaction against the cluster before signing it.
 *
 * WHAT THIS CLOSES
 *
 * `simulationRequired` is a builder switch that has been persisted, validated, versioned and
 * reloaded since the builder shipped, and read by nothing. The bot control contract has carried
 * it as pending with the note "Simulation is applied by policy to every submission and is not
 * switchable per bot" — which was generous. There was no simulation step in the engine at all.
 * `scripts/verify-mainnet-simulation.mjs` simulates; the worker never did.
 *
 * WHY IT MATTERS MORE THAN A QUOTE
 *
 * A quote says a route exists at a price. A simulation runs the actual instructions against
 * current cluster state and reports the error the real submission would hit — a missing token
 * account, a transfer-fee extension the route did not account for, a pool that moved past the
 * slippage bound, an unfunded rent requirement. Those are precisely the failures that cost a
 * user their priority fee and produce nothing, and they are invisible to the quote.
 *
 * NOTHING IS SIGNED OR SENT HERE. `simulateTransaction` with `sigVerify: false` cannot mutate
 * the ledger; it is the same read-only method the mainnet verifier uses, and the transaction it
 * receives is unsigned.
 *
 * FAIL CLOSED, BUT ONLY WHEN ASKED. A bot with `simulationRequired` on and a simulation that
 * cannot be obtained is refused — an unavailable RPC is not evidence the trade is safe. A bot
 * with it off skips the step entirely rather than simulating and ignoring the answer, because
 * spending a round trip to discard the result is the worst of both.
 */

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const TIMEOUT_MS = 10_000;

/**
 * Errors that mean "this transaction would fail", as opposed to "we could not find out".
 *
 * The distinction is the whole point. A refusal has to say which of the two happened, or an
 * operator debugging a silent bot cannot tell a bad route from a bad RPC.
 */
function describe(err) {
  if (err === null || err === undefined) return null;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err).slice(0, 200);
  } catch {
    return "unknown simulation error";
  }
}

async function rpcCall(rpc, method, params) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`rpc ${method} -> ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message || "error"}`);
  return body.result;
}

/**
 * Simulate an unsigned base64 transaction.
 *
 * Returns one of:
 *   { ok: true,  simulated: true,  unitsConsumed, logs }   the cluster executed it cleanly
 *   { ok: false, simulated: true,  reason }                the cluster rejected it
 *   { ok: false, simulated: false, reason }                we could not reach a verdict
 *
 * The caller decides what an unreachable verdict means; this function never decides for it.
 */
async function simulateTransaction(base64Tx, { rpc = process.env.MAINNET_RPC || DEFAULT_RPC } = {}) {
  if (typeof base64Tx !== "string" || !base64Tx) {
    return { ok: false, simulated: false, reason: "no transaction to simulate" };
  }
  let result;
  try {
    result = await rpcCall(rpc, "simulateTransaction", [
      base64Tx,
      // sigVerify false because the transaction is UNSIGNED at this point — that is the whole
      // reason this runs before the signer. replaceRecentBlockhash keeps a blockhash that aged
      // during the quote from being reported as a route failure.
      { sigVerify: false, replaceRecentBlockhash: true, encoding: "base64", commitment: "confirmed" }
    ]);
  } catch (error) {
    return { ok: false, simulated: false, reason: `simulation unavailable: ${error.message}` };
  }

  const value = result?.value;
  if (!value) return { ok: false, simulated: false, reason: "simulation returned no result" };

  const err = describe(value.err);
  if (err) {
    const logs = Array.isArray(value.logs) ? value.logs : [];
    // The last program log is almost always the one naming the failure; the raw err code alone
    // is rarely actionable on its own.
    const detail = logs.filter((line) => /Error|failed|insufficient/i.test(line)).slice(-1)[0];
    return {
      ok: false,
      simulated: true,
      reason: `simulation failed: ${err}${detail ? ` — ${detail.slice(0, 160)}` : ""}`
    };
  }

  return {
    ok: true,
    simulated: true,
    unitsConsumed: typeof value.unitsConsumed === "number" ? value.unitsConsumed : null,
    logs: Array.isArray(value.logs) ? value.logs.length : 0
  };
}

/**
 * The gate the engine calls: simulate when this bot asked for it, and decide.
 *
 * `required` comes from the subscriber's immutable configuration snapshot. Absent reads as ON,
 * matching the builder's default and every other safety control here — a bot saved before this
 * switch had a reader gets the safer behaviour, not the looser one.
 */
async function guardWithSimulation(base64Tx, { required = true, rpc } = {}) {
  if (required === false) return { ok: true, skipped: true, reason: "simulation not required by this bot" };
  const verdict = await simulateTransaction(base64Tx, { rpc });
  if (verdict.ok) return { ok: true, skipped: false, unitsConsumed: verdict.unitsConsumed };
  // Both failure shapes refuse, and the reason distinguishes them so an operator can tell a bad
  // route from a bad RPC without reading code.
  return { ok: false, skipped: false, reason: verdict.reason, simulated: verdict.simulated };
}

module.exports = { simulateTransaction, guardWithSimulation, describe, DEFAULT_RPC };
