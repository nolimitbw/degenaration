/**
 * Push-triggered call execution.
 *
 * The website POSTs here the instant a Discord call is journaled, so a subscriber's
 * buy goes out on the call, not on the next poll tick. `startCallWatcher` in calls.js
 * still runs as the backstop for anything this path missed (site restart, network
 * blip), and the two are safe together: claimCallExecution is unique per
 * (call, subscription), so a call handled twice is still bought once.
 *
 * No new dependencies — this rides the worker's existing health HTTP server.
 */
const { executeCall } = require("./calls");

/**
 * Serialize dispatches per call id. Two pushes for the same call (a retry, or the poll
 * arriving at the same moment) must not fan out to subscribers concurrently — the claim
 * would still protect us, but doing the work twice wastes a Jupiter quote per subscriber.
 */
function createCallDispatcher(deps) {
  const { loadCallById, onEvent = () => {} } = deps;
  const seen = deps.seen || new Set();
  const inFlight = new Map();

  async function run(callId) {
    if (seen.has(callId)) return { ok: true, status: "already handled" };

    let call;
    try { call = await loadCallById(callId); }
    catch (e) {
      onEvent({ type: "DISPATCH_LOAD_ERROR", call: callId, error: e.message });
      return { ok: false, status: "call lookup failed" };
    }
    if (!call?.id || !call.mint || !call.group_id) {
      return { ok: false, status: "call not executable" };
    }
    if (call.executed_at) {
      seen.add(call.id);
      return { ok: true, status: "already executed" };
    }

    onEvent({ type: "DISPATCH", call: call.id, group: call.group_id, mint: call.mint });
    if (await executeCall(call, { ...deps, seen })) seen.add(call.id);
    return { ok: true, status: "dispatched" };
  }

  return function dispatch(callId) {
    if (!callId) return Promise.resolve({ ok: false, status: "call id required" });
    const existing = inFlight.get(callId);
    if (existing) return existing;

    const pending = run(callId)
      .catch((e) => {
        onEvent({ type: "DISPATCH_ERROR", call: callId, error: e.message });
        return { ok: false, status: "dispatch failed" };
      })
      .finally(() => inFlight.delete(callId));
    inFlight.set(callId, pending);
    return pending;
  };
}

module.exports = { createCallDispatcher };
