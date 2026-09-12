/**
 * The pre-submit simulation gate, driven over a real HTTP boundary.
 *
 * WHY THIS IS A SCRIPT AND NOT A UNIT TEST. `server/test/run.js` is synchronous by design — it
 * reports a promise-returning test as an error rather than silently skipping its assertions,
 * which is how these properties would otherwise have looked green while proving nothing.
 * Simulation is network I/O, so it lives here, in the same place every other I/O-shaped verifier
 * in this repository lives.
 *
 * WHAT IT PROVES. `simulationRequired` was a builder switch with no reader — and the step it
 * names did not exist in the engine at all. `scripts/verify-mainnet-simulation.mjs` simulated;
 * the worker never did. A quote says a route exists at a price; a simulation runs the
 * instructions against cluster state and returns the error the real submission would hit.
 *
 * NOTHING REACHES A CLUSTER. Every RPC below is a local stub. The one property that matters for
 * safety — that the call is `simulateTransaction` with `sigVerify: false`, never
 * `sendTransaction` — is asserted against the exact JSON-RPC body the engine emits.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { guardWithSimulation, simulateTransaction } = require(`${process.cwd()}/server/engine/simulate.js`);

const results = {};

/** A local JSON-RPC stub. Returns the body it was called with, so the call can be asserted. */
function stub(handler) {
  return new Promise((resolve) => {
    const calls = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        calls.push(parsed);
        const reply = handler(parsed);
        res.writeHead(reply.status || 200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      calls,
      close: () => server.close()
    }));
  });
}

const ok = (value) => ({ body: { jsonrpc: "2.0", id: 1, result: { value } } });

// ── 1. a clean simulation allows the trade and reports what it cost ─────────────────────────
{
  const rpc = await stub(() => ok({
    err: null, unitsConsumed: 72071, logs: ["Program JUP6 invoke [1]", "Program JUP6 success"]
  }));
  const verdict = await guardWithSimulation("dHg=", { rpc: rpc.url });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.skipped, false);
  assert.equal(verdict.unitsConsumed, 72071);
  rpc.close();
  results.cleanSimulationAllows = "PASS";
}

// ── 2. a cluster rejection refuses, and carries the program's own words ─────────────────────
//
// The error code alone is rarely actionable. "Custom: 6001" tells an operator nothing; "slippage
// tolerance exceeded" tells them which control to change.
{
  const rpc = await stub(() => ok({
    err: { InstructionError: [3, { Custom: 6001 }] },
    logs: ["Program log: Instruction: Swap", "Program log: Error: slippage tolerance exceeded"]
  }));
  const verdict = await guardWithSimulation("dHg=", { rpc: rpc.url });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.simulated, true, "the cluster DID answer — this is a route failure");
  assert.match(verdict.reason, /simulation failed/);
  assert.match(verdict.reason, /slippage tolerance exceeded/);
  rpc.close();
  results.clusterRejectionRefuses = "PASS";
}

// ── 3. unavailable is not evidence of safety ────────────────────────────────────────────────
//
// The two failures must stay distinguishable. Reporting an unreachable RPC as a route failure
// would send an operator to change a setting that was never the problem.
{
  const unreachable = await guardWithSimulation("dHg=", { rpc: "http://127.0.0.1:1" });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.simulated, false);
  assert.match(unreachable.reason, /simulation unavailable/);

  const rpcError = await stub(() => ({ body: { jsonrpc: "2.0", id: 1, error: { message: "node behind" } } }));
  const behind = await guardWithSimulation("dHg=", { rpc: rpcError.url });
  assert.equal(behind.ok, false);
  assert.equal(behind.simulated, false, "an RPC-level error is not a verdict about the transaction");
  rpcError.close();

  const empty = await stub(() => ({ body: { jsonrpc: "2.0", id: 1, result: {} } }));
  const noValue = await guardWithSimulation("dHg=", { rpc: empty.url });
  assert.equal(noValue.ok, false);
  assert.equal(noValue.simulated, false);
  empty.close();
  results.unavailableIsNotSafety = "PASS";
}

// ── 4. the switch actually switches ─────────────────────────────────────────────────────────
//
// Off SKIPS the step rather than simulating and discarding the answer — spending a round trip
// to ignore the result is the worst of both. Proven by pointing it at a dead port: a bot with
// the switch off must still be allowed through.
{
  const off = await guardWithSimulation("dHg=", { required: false, rpc: "http://127.0.0.1:1" });
  assert.equal(off.ok, true);
  assert.equal(off.skipped, true);

  // Absent reads as ON, matching the builder default and every other safety control here.
  const absent = await guardWithSimulation("dHg=", { rpc: "http://127.0.0.1:1" });
  assert.equal(absent.ok, false, "an unset switch must simulate, not skip");
  results.switchActuallySwitches = "PASS";
}

// ── 5. the call is read-only, unsigned, and never a submission ──────────────────────────────
{
  const rpc = await stub(() => ok({ err: null, unitsConsumed: 1, logs: [] }));
  await guardWithSimulation("dHg=", { rpc: rpc.url });
  const [call] = rpc.calls;
  assert.equal(call.method, "simulateTransaction", "must never be sendTransaction");
  assert.equal(call.params[0], "dHg=");
  assert.equal(call.params[1].sigVerify, false,
    "sigVerify must be false — the transaction is UNSIGNED at this point, which is the whole " +
    "reason this runs before the signer");
  assert.equal(call.params[1].replaceRecentBlockhash, true,
    "a blockhash that aged during the quote must not be reported as a route failure");
  assert.equal(call.params[1].encoding, "base64");
  rpc.close();
  results.readOnlyUnsignedCall = "PASS";
}

// ── 6. an empty transaction is refused rather than simulated ────────────────────────────────
{
  for (const bad of ["", null, undefined, 42]) {
    const verdict = await simulateTransaction(bad, {});
    assert.equal(verdict.ok, false);
    assert.equal(verdict.simulated, false);
    assert.equal(verdict.reason, "no transaction to simulate");
  }
  results.emptyTransactionRefused = "PASS";
}

console.log(JSON.stringify({
  verifier: "simulation-gate",
  transport: "local JSON-RPC stubs — nothing reaches a cluster",
  properties: Object.keys(results).length,
  ...results,
  proves:
    "the engine simulates before it signs; a cluster rejection refuses the trade and carries " +
    "the program's own words; an unreachable RPC also refuses but stays distinguishable from a " +
    "route failure; the builder switch genuinely skips the step when off and simulates when " +
    "absent; and the call is simulateTransaction with sigVerify false, never a submission",
  notProven: "that a deployed worker executes this path with signing enabled — that is the owner gate"
}, null, 2));
