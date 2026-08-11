/**
 * The one place the engine's watchers are wired to the store.
 *
 * WHY THIS FILE EXISTS
 *
 * The watchers take their dependencies by name, and several of those names DIFFER from the
 * store's exports:
 *
 *   settlement wants  loadSubmitted     store exports  loadSubmittedExecutions
 *   monitor wants     claimExit         store exports  claimPositionExit
 *   monitor wants     settleExit        store exports  settlePositionExit
 *   monitor wants     recordPendingExit store exports  recordPositionExitSig
 *   monitor wants     recordPeak        store exports  recordPositionPeak
 *
 * That mapping used to live only inside server/worker.js. When the engine was given a second
 * caller — `app/api/worker/tick`, which runs it on Vercel because the worker has no host — the
 * new caller passed `{ ...store }` and the renamed dependencies silently arrived as undefined.
 * The watcher caught it, reported `LOAD_ERROR`, and returned. Production showed
 * `mode: "live"` with seven load errors and no trades: a green status over a dead path.
 *
 * That is this codebase's signature failure — two individually correct halves that were never
 * checked against each other — reproduced by the very change meant to get trading running. So
 * the mapping stops being something a caller reimplements. Both callers import it from here,
 * and a rename breaks one file instead of quietly disabling one deployment.
 *
 * Pure: it only reshapes an object. Every I/O dependency is still passed in, so the whole thing
 * stays testable without network, a database, or a signer.
 */

/** Take-profit / stop-loss, and DCA placement. */
function monitorDeps(store, { getPrice, signAndSend, confirmSignature, onEvent }) {
  return {
    loadOpenPositions: store.loadOpenPositions,
    getPrice,
    claimExit: store.claimPositionExit,
    settleExit: store.settlePositionExit,
    recordPendingExit: store.recordPositionExitSig,
    recordPeak: store.recordPositionPeak,
    recordStopBreach: store.recordStopBreach,
    // Wired, or the four DCA controls stay where they have been since the builder shipped:
    // persisted, counted toward the capital the user is told to fund, and never placed.
    recordDcaFill: store.recordDcaFill,
    recordTrade: store.recordTrade,
    signAndSend,
    confirmSignature,
    onEvent
  };
}

/** Resolves submitted buys against the chain and opens the position the monitor watches. */
function settlementDeps(store, { getPrice, confirmSignature, fetchReceivedAmount, onEvent }) {
  return {
    loadSubmitted: store.loadSubmittedExecutions,
    confirmSignature,
    fetchReceivedAmount,
    getPrice,
    openPosition: store.openPosition,
    settleExecution: store.settleExecution,
    recordTrade: store.recordTrade,
    onEvent
  };
}

/** Discord group calls, mirrored to each group's subscribers. */
function callDeps(store, { signAndSend, onEvent }) {
  return {
    loadPendingCalls: store.loadPendingCalls,
    loadGroupSubscribers: store.loadGroupSubscribers,
    subscriberSafety: store.subscriberSafety,
    // The subscriber's own priority-fee cap and quote window, from the SAME immutable snapshot
    // their filters come from. calls.js defaults this to "not configured", so leaving it
    // unwired makes both controls resolve to null in production while every test passes.
    subscriberExecution: store.subscriberExecution,
    claimCallExecution: store.claimCallExecution,
    finishCallExecution: store.finishCallExecution,
    submitCallExecution: store.submitCallExecution,
    completeCall: store.completeCall,
    markCallExecuted: store.markCallExecuted,
    signAndSend,
    onEvent
  };
}

/** Limit orders. */
function limitDeps(store, { getPrice, signAndSend, onEvent }) {
  return {
    loadOpenOrders: store.loadOpenOrders,
    getPrice,
    signAndSend,
    claimOrder: store.claimLimitOrder,
    finishOrder: store.finishLimitOrder,
    recordTrade: store.recordTrade,
    onEvent
  };
}

/**
 * Every dependency name any watcher asks for must exist on the store, or that watcher fails
 * closed at runtime with a message naming nothing useful. Callable as a startup assertion.
 */
function missingWiring(store) {
  const noop = () => {};
  const io = { getPrice: noop, signAndSend: noop, confirmSignature: noop, fetchReceivedAmount: noop, onEvent: noop };
  const built = {
    ...monitorDeps(store, io),
    ...settlementDeps(store, io),
    ...callDeps(store, io),
    ...limitDeps(store, io)
  };
  return Object.entries(built)
    .filter(([, value]) => typeof value !== "function")
    .map(([name]) => name);
}

module.exports = { monitorDeps, settlementDeps, callDeps, limitDeps, missingWiring };
