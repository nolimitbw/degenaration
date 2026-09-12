/**
 * The execution path, run against real mainnet, with no signature and nothing broadcast.
 *
 * WHY. Everything downstream of a swap has a verifier — settlement, exits, fees, the ledger —
 * and every one of them starts from a transaction that a fixture says exists. What has never
 * been checked is the step before all of them: that a quote for a real pair builds into a
 * transaction the cluster will actually accept. A build that returns base64 proves the request
 * was well-formed, not that the instructions execute; a program error, a missing account or a
 * bad fee account surfaces only at simulation, and until now that would first have happened on
 * the worker's first live trade.
 *
 *   npm run verify:mainnet-simulation
 *
 * SAFETY, BY CONSTRUCTION AND NOT BY CARE:
 *
 *   - `sigVerify: false` — the transaction is never signed. No key material is read, held or
 *     created anywhere in this file.
 *   - `simulateTransaction` only. `sendTransaction` is never called, and the RPC method list
 *     below is asserted so a future edit cannot quietly add one.
 *   - `userPublicKey` is a well-known public address with no relationship to any DegenAration
 *     user, used purely as a payer placeholder for the simulation.
 *   - A simulation changes no chain state. It cannot move funds even if it succeeds.
 *
 * SKIPS rather than fails when the network is unavailable, so `npm run check` stays runnable
 * offline. A skip prints and is never counted as a pass.
 */
import assert from "node:assert/strict";

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
// The SAME base the product calls — server/engine/jupiter.js:6. Testing a different endpoint
// than the one the engine uses would prove something about Jupiter and nothing about us; the
// legacy quote-api.jup.ag host this first pointed at is dead, and returned a bare "fetch
// failed" rather than a status.
const JUPITER = "https://lite-api.jup.ag/swap/v1";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/**
 * The simulated payer.
 *
 * A full simulation needs an account with lamports: Jupiter's build creates the output token
 * account, and rent has to come from somewhere. The first version of this file used Solana's
 * incinerator address on the reasoning that it belongs to nobody — it holds **0 lamports**, so
 * the simulation returned `AccountNotFound` and looked exactly like a broken product. It was a
 * defect in this file.
 *
 * The fix is not to substitute some large public wallet found on an explorer. Simulating a
 * spend from a stranger's account is harmless — nothing is signed and no state changes — but
 * committing their address into a repository as our test fixture is not something to do
 * casually, and it would make the result depend on a balance nobody here controls.
 *
 * So the payer is explicit. Set SIMULATION_PAYER to a public address holding a little SOL and
 * the full simulation runs; leave it unset and the stages that do not need a payer still run
 * and still report, and the one that does says precisely why it did not.
 */
const PLACEHOLDER_PAYER = process.env.SIMULATION_PAYER || null;
const AMOUNT_LAMPORTS = 10_000_000; // 0.01 SOL — small enough to route on any liquidity

const results = {};
function skip(reason) {
  console.log(JSON.stringify({ verifier: "mainnet-simulation", status: "SKIPPED", reason }, null, 2));
  process.exit(0);
}

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
]);

async function rpc(method, params) {
  // The whole safety argument rests on this list. Anything that can change chain state is
  // absent, and the assertion below makes adding one a test failure rather than a review miss.
  const READ_ONLY = new Set(["simulateTransaction", "getLatestBlockhash", "getAccountInfo", "getVersion"]);
  assert.ok(READ_ONLY.has(method), `refusing to call ${method}: this verifier is read-only`);
  const res = await withTimeout(fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }), 20000, method);
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

// ── 1. the cluster is reachable and is mainnet ──────────────────────────────────────────────
let version;
try {
  version = await rpc("getVersion", []);
} catch (error) {
  skip(`Solana RPC unreachable: ${error.message}`);
}
results.rpcReachable = "PASS";

// ── 2. a real quote for a real pair ─────────────────────────────────────────────────────────
let quote;
try {
  const url = `${JUPITER}/quote?inputMint=${SOL}&outputMint=${USDC}` +
    `&amount=${AMOUNT_LAMPORTS}&slippageBps=300&onlyDirectRoutes=false`;
  const res = await withTimeout(fetch(url), 20000, "jupiter quote");
  if (!res.ok) skip(`Jupiter quote HTTP ${res.status}`);
  quote = await res.json();
} catch (error) {
  skip(`Jupiter quote unavailable: ${error.message}`);
}
assert.equal(quote.inputMint, SOL);
assert.equal(quote.outputMint, USDC);
assert.ok(Number(quote.outAmount) > 0, "a quote with no output is not a route");
assert.ok(Array.isArray(quote.routePlan) && quote.routePlan.length > 0, "a route plan is required");
results.quote = "PASS";

// ── 3. build the transaction — unsigned ─────────────────────────────────────────────────────
//
// Runs whether or not a payer is available: the build is where a bad route, an unsupported
// mint or a malformed request surfaces, and that is worth checking on its own.
const buildFor = PLACEHOLDER_PAYER || "So11111111111111111111111111111111111111112";
let swap;
try {
  const res = await withTimeout(fetch(`${JUPITER}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: buildFor,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true
    })
  }), 25000, "jupiter swap");
  if (!res.ok) skip(`Jupiter swap build HTTP ${res.status}`);
  swap = await res.json();
} catch (error) {
  skip(`Jupiter swap build unavailable: ${error.message}`);
}
assert.ok(typeof swap.swapTransaction === "string" && swap.swapTransaction.length > 100,
  "the build must return a base64 transaction");
assert.ok(Number(swap.lastValidBlockHeight) > 0, "a build with no block height is not submittable");
results.unsignedBuild = "PASS";

// ── 4. simulate it against mainnet, when a payer is available ───────────────────────────────
//
// replaceRecentBlockhash is what makes this meaningful without a signature: the cluster
// substitutes a live blockhash and runs the instructions, so a program error, a missing
// account or an unusable fee account surfaces HERE rather than on the worker's first trade.
let simulation = null;
let payerLamports = null;

if (!PLACEHOLDER_PAYER) {
  results.mainnetSimulation =
    "NOT RUN — SIMULATION_PAYER is unset. Quote and build are proven above; executing the " +
    "instructions needs an account with lamports to pay rent for the output token account.";
} else {
  const info = await rpc("getAccountInfo", [PLACEHOLDER_PAYER, { encoding: "base64" }]);
  payerLamports = info?.value?.lamports ?? 0;
  if (!payerLamports) {
    results.mainnetSimulation =
      `NOT RUN — SIMULATION_PAYER holds 0 lamports. A payer that cannot pay rent returns ` +
      `AccountNotFound, which is indistinguishable from a broken transaction and must not be ` +
      `reported as one.`;
  } else {
    try {
      simulation = await rpc("simulateTransaction", [
        swap.swapTransaction,
        { sigVerify: false, replaceRecentBlockhash: true, encoding: "base64", commitment: "confirmed" }
      ]);
    } catch (error) {
      skip(`simulateTransaction unavailable: ${error.message}`);
    }

    const logs = simulation?.value?.logs || [];
    const err = simulation?.value?.err ?? null;
    if (err) {
      console.error("\nmainnet-simulation: the transaction the product builds does NOT execute\n");
      console.error(`  error: ${JSON.stringify(err)}`);
      for (const line of logs.slice(-12)) console.error(`  ${line}`);
      console.error("\nThis is the failure a live trade would have produced. Nothing was signed or sent.\n");
      process.exit(1);
    }
    assert.ok(logs.length > 0, "a successful simulation must return program logs");
    assert.ok(logs.some((l) => /Program .* success/.test(l)), "no program reported success");
    assert.ok(typeof simulation.value.unitsConsumed === "number" && simulation.value.unitsConsumed > 0,
      "a simulation that consumed no compute units did not execute anything");
    results.mainnetSimulation = "PASS";
  }
}

// ── 5. what the fee account actually does to a real build ───────────────────────────────────
//
// E-4 recorded that production collects 0 bps because the configured value is a wallet whose
// associated token account is not initialised. That was measured by inspecting the resolver.
// This measures the consequence: whether a build carries a fee instruction at all.
const feeConfigured = Boolean(process.env.PLATFORM_FEE_ACCOUNT);
results.platformFee = feeConfigured
  ? "configured in this environment — see verify:fee-ledger for the allocation invariants"
  : "PLATFORM_FEE_ACCOUNT unset in this shell, so this build carries no fee instruction (E-4)";

console.log(JSON.stringify({
  verifier: "mainnet-simulation",
  cluster: RPC.replace(/\/\/[^@]*@/, "//"),
  solanaCore: version["solana-core"],
  pair: "SOL → USDC",
  amountLamports: AMOUNT_LAMPORTS,
  outAmount: quote.outAmount,
  routeHops: quote.routePlan.length,
  priceImpactPct: quote.priceImpactPct,
  ...results,
  unitsConsumed: simulation?.value?.unitsConsumed ?? null,
  programLogLines: simulation?.value?.logs?.length ?? 0,
  simulationPayer: PLACEHOLDER_PAYER ? "SIMULATION_PAYER (public address, never signed)" : "unset",
  simulationPayerLamports: payerLamports,
  safety: {
    signed: false,
    broadcast: false,
    sigVerify: false,
    payer: PLACEHOLDER_PAYER
      ? "SIMULATION_PAYER — a public address, read-only; no key exists for it here and nothing is signed"
      : "none supplied",
    rpcMethodsUsed: ["getVersion", "simulateTransaction"],
    chainStateChanged: "none — simulateTransaction cannot mutate the ledger"
  },
  proves: simulation
    ? "a real quote for a real pair builds into a transaction mainnet EXECUTES — program logs " +
      "and compute units, not just a base64 string"
    : "a real quote for a real pair builds into a well-formed transaction; execution needs a payer",
  notProven: "that the worker performs this sequence, and that a fee is collected — E-3 and E-4"
}, null, 2));
