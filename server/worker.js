/**
 * DEGENARATION automation worker — runs the limit-order + copy-trade watchers 24/7.
 *   node worker.js
 *
 * NON-CUSTODIAL: execution requires DELEGATED session-key signing (Privy). Until that is
 * wired in `signAndSend` below, the worker WATCHES and logs triggers but refuses to send
 * a transaction — so it can never move funds by accident. See GO-LIVE Phase A/E.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, MAINNET_RPC (paid recommended),
 *      PLATFORM_FEE_ACCOUNT (optional platform fee), PRIVY_APP_ID/PRIVY_APP_SECRET (for signing).
 */
require("dotenv").config();
const http = require("http");
const { getPrice } = require("./engine/prices");
const { startLimitWatcher } = require("./engine/limits");
const { startCopyWatcher } = require("./engine/copy");
const { startCallWatcher } = require("./engine/calls");
const { startPerformanceScanner } = require("./engine/performance");
const { startSettlementWatcher } = require("./engine/settlement");
const { startMonitor } = require("./engine/monitor");
const jupiter = require("./engine/jupiter");
const { confirmSignature, fetchReceivedAmount } = require("./engine/confirm");
const { missingExitPath } = require("./engine/exit-path");
const signer = require("./engine/signer");
const store = require("./engine/store");

const SIGNING_READY = process.env.DELEGATED_SIGNING === "on";
const COPY_TRADING_READY = SIGNING_READY && process.env.COPY_TRADING === "on";
const NET = String(process.env.WORKER_NET || "").trim().toLowerCase();
const PORT = Number(process.env.PORT || 10000);
const HEALTH_HOST = process.env.HEALTH_HOST || "0.0.0.0";
const startedAt = Date.now();
const state = { events: 0, errors: 0, lastEventAt: null, lastError: null };
jupiter.ensureFeeAccountChecked().catch((error) => {
  console.warn(`[worker] fee readiness probe failed: ${error?.message || error}`);
});

/**
 * Sign+send a base64 tx with the user's Privy delegated session key (see engine/signer.js).
 * Gated by DELEGATED_SIGNING so the worker is watch-only until you have verified signing on
 * devnet. walletId is the Privy embedded-wallet id stored on the order/subscription.
 */
async function signAndSend(base64Tx, walletId, intent = {}) {
  if (!SIGNING_READY) throw new Error("delegated signing OFF (watch-only) — set DELEGATED_SIGNING=on after devnet verification");
  // `intent` binds the signature to the authorisation: the wallet that must be the fee payer,
  // the lamport ceiling, and when the transaction was built. engine/signer-policy.js refuses
  // anything that does not match, so a caller that omits it gets a refusal rather than a
  // permissive default.
  return signer.signAndSend(base64Tx, walletId, NET, intent);
}

function log(tag) {
  return (event) => {
    state.events += 1;
    state.lastEventAt = new Date().toISOString();
    if (String(event?.type || "").includes("ERROR") || event?.type === "LOAD_ERROR") {
      state.errors += 1;
      state.lastError = String(event?.error || event?.type || "worker error").slice(0, 300);
    }
    console.log(`[${tag}]`, JSON.stringify(event));
  };
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("[worker] missing SUPABASE_URL / SUPABASE_SERVICE_KEY — cannot load orders. Exiting.");
  process.exit(1);
}

if (!new Set(["mainnet", "devnet"]).has(NET)) {
  console.error("[worker] WORKER_NET must be mainnet or devnet. Exiting.");
  process.exit(1);
}

if (SIGNING_READY) {
  const missing = ["PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_AUTHORIZATION_KEY"]
    .filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`[worker] delegated signing requested but missing ${missing.join(", ")}. Exiting.`);
    process.exit(1);
  }
}

/**
 * SAFETY GATE — the exit path must exist before signing may be enabled.
 * See docs/adr/ADR-001-worker-deployment.md, action item 4.
 *
 * A worker that can buy but not sell turns a user's configured stop loss into a promise the
 * code cannot keep: the worker buys, the token falls, and nothing sells. That was the state
 * this gate was written for — `startMonitor` existed but was never called, and nothing
 * produced the positions it takes as a parameter.
 *
 * WHY THIS IS DERIVED RATHER THAN DECLARED. A `const EXITS_WIRED = true` could be flipped by
 * anyone who wanted the worker to boot, making it exactly as weak as the document it
 * enforces. Naming the store functions the path genuinely cannot work without means the
 * gate retires itself when the path is really built, and re-arms the moment one is removed
 * or renamed.
 *
 * It is necessary, not sufficient. It proves the pieces exist, not that they are correct —
 * that is what server/test/run.js covers: the pending-exit block, the confirmation
 * classifier, and the settlement transitions.
 */
const missing = missingExitPath(store);

if (SIGNING_READY && missing.length) {
  console.error(
    "[worker] REFUSING TO START — DELEGATED_SIGNING=on but this worker has no way to exit a position.\n" +
    `         Missing from engine/store.js: ${missing.join(", ")}\n` +
    "         Without the full capture-and-exit path, take-profit and stop-loss cannot fire\n" +
    "         on anything this worker buys, and users' configured stop losses would be\n" +
    "         silently unenforced.\n" +
    "         See docs/adr/ADR-001-worker-deployment.md, action item 4.\n" +
    "         To run measurement only, set DELEGATED_SIGNING=off — the performance scanner\n" +
    "         runs outside every signing gate and needs none of this."
  );
  process.exit(1);
}

console.log(`[worker] starting — signing ${SIGNING_READY ? "ENABLED" : "DISABLED (watch-only)"}`);

http.createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/health") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({
    status: "ok",
    build: process.env.APP_BUILD_SHA || null,
    mode: SIGNING_READY ? "live" : "watch-only",
    signingEnabled: SIGNING_READY,
    copyTradingEnabled: COPY_TRADING_READY,
    network: NET,
    feeEnabled: jupiter.feeAccountReady(),
    capabilities: {
      durableIntents: typeof store.claimCallExecution === "function",
      quote: typeof getPrice === "function",
      simulation: true,
      submission: SIGNING_READY && typeof signAndSend === "function",
      confirmation: typeof confirmSignature === "function",
      positionCapture: typeof store.openPosition === "function",
      takeProfitStopLoss: missing.length === 0,
      dailyRisk: typeof store.claimCallExecution === "function",
      reconciliation: typeof store.settleExecution === "function" && typeof store.settlePositionExit === "function"
    },
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    ...state
  }));
}).listen(PORT, HEALTH_HOST, () => console.log(`[worker] health listening on ${HEALTH_HOST}:${PORT}`));

/**
 * Stay awake on a free web-service tier.
 *
 * Render's free plan suspends a web service after roughly fifteen minutes with no INBOUND
 * HTTP request, and a suspended worker is not watch-only — it is absent. It misses the calls
 * it exists to catch, `worker_leases` goes stale, and the app correctly reports the worker as
 * gone. Nothing in this process's own polling counts as traffic, because those are outbound.
 *
 * So the service requests its own public URL. The round trip leaves the platform and comes
 * back through the router, which is what the idle timer measures. `RENDER_EXTERNAL_URL` is
 * injected by Render; on any host that does not set it — Railway, a VM, a laptop — this whole
 * block is inert, which is the correct behaviour rather than a special case to configure.
 *
 * This PREVENTS sleep; it cannot end it. A service already suspended has no process to run the
 * timer. That is the honest limit of the technique and the reason the interval is well inside
 * the window rather than near it.
 *
 * A failed ping is logged once and otherwise ignored. Keeping the container warm is a hosting
 * concern, and it must never be able to interrupt an exit that is mid-flight.
 */
const KEEP_ALIVE_URL = process.env.RENDER_EXTERNAL_URL?.trim() || process.env.WORKER_PUBLIC_URL?.trim() || null;
const KEEP_ALIVE_INTERVAL_MS = 10 * 60_000;

if (KEEP_ALIVE_URL) {
  console.log(`[worker] keep-alive every ${KEEP_ALIVE_INTERVAL_MS / 60_000}m against ${KEEP_ALIVE_URL}`);
  setInterval(() => {
    const target = new URL("/health", KEEP_ALIVE_URL);
    fetch(target, { cache: "no-store", signal: AbortSignal.timeout(20_000) })
      .catch((error) => console.log(`[worker] keep-alive ping failed: ${error?.message || error}`));
  }, KEEP_ALIVE_INTERVAL_MS).unref?.();
}

/**
 * Report liveness into the database the trades are recorded in.
 *
 * The /health endpoint above answers whoever can reach this container's port. That is not the
 * question the product asks: `RUN` has to know, from the app, whether a worker is alive before
 * it activates a bot, and the app cannot reach a Railway-internal port. The database is the one
 * place both sides already meet.
 *
 * The writer for this has existed and been deployed the whole time and nothing ever called it,
 * which left app_private.worker_leases empty while the worker ran. See
 * supabase/degenaration-worker-liveness.sql.
 *
 * THE LEASE IS A PROMISE, so the interval must be comfortably shorter than it. 90 seconds of
 * lease against a 30-second beat survives two consecutive failures before the app is told the
 * worker is gone.
 *
 * Reporting is not trading. A heartbeat failure is counted and logged and changes nothing else:
 * a worker that cannot reach PostgREST for a status write can still be mid-exit on a real
 * position, and stopping it to preserve a report would be exactly backwards.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_LEASE_SECONDS = 90;
// Render's instance id is checked before Railway's so a migrated worker still identifies the
// container it is actually running in rather than falling through to the pod hostname.
const INSTANCE_ID = `${process.env.RENDER_INSTANCE_ID || process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local"}:${startedAt}`;
const heartbeatMode = NET === "devnet" ? "solana-devnet" : NET === "paper" ? "paper" : "solana-mainnet";

async function beat() {
  try {
    await store.workerHeartbeat(INSTANCE_ID, heartbeatMode, HEARTBEAT_LEASE_SECONDS, {
      // Facts the Admin Console can act on. Deliberately no secret, no wallet, no signer
      // material -- this row is readable by every server-side caller of app_worker_liveness.
      signingEnabled: SIGNING_READY,
      copyTradingEnabled: COPY_TRADING_READY,
      feeConfigured: Boolean(process.env.PLATFORM_FEE_ACCOUNT),
      build: process.env.APP_BUILD_SHA || null,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      events: state.events,
      errors: state.errors
    });
  } catch (error) {
    state.errors += 1;
    state.lastError = `heartbeat: ${String(error.message).slice(0, 160)}`;
    console.error("[worker] heartbeat failed —", state.lastError);
  }
}
beat();
setInterval(beat, HEARTBEAT_INTERVAL_MS).unref?.();

if (SIGNING_READY) {
  startLimitWatcher({
    loadOpenOrders: store.loadOpenOrders, getPrice, signAndSend,
    claimOrder: store.claimLimitOrder, finishOrder: store.finishLimitOrder,
    recordTrade: store.recordTrade, onEvent: log("limit")
  });

  // Discord group calls -> mirror to each group's subscribers.
  startCallWatcher({
    loadPendingCalls: store.loadPendingCalls, loadGroupSubscribers: store.loadGroupSubscribers,
    subscriberSafety: store.subscriberSafety,
    // The subscriber's own priority-fee cap and quote window, from the SAME immutable snapshot
    // their filters come from. engine/calls.js defaults this to "not configured", so leaving it
    // unwired here would have made both controls resolve to null in production while every
    // test passed — the control wired at one end and not the other, which is the defect class
    // this whole session has been closing.
    subscriberExecution: store.subscriberExecution,
    claimCallExecution: store.claimCallExecution, finishCallExecution: store.finishCallExecution,
    submitCallExecution: store.submitCallExecution,
    completeCall: store.completeCall, markCallExecuted: store.markCallExecuted, signAndSend,
    onEvent: log("call")
  });

  // Resolves submitted buys against the chain, records the trade only once it landed, and
  // opens the position the monitor below watches. Without this nothing produces positions.
  startSettlementWatcher({
    loadSubmitted: store.loadSubmittedExecutions,
    confirmSignature, fetchReceivedAmount, getPrice,
    openPosition: store.openPosition, settleExecution: store.settleExecution,
    recordTrade: store.recordTrade, onEvent: log("settle")
  });

  // Take-profit / stop-loss. Every exit is claimed atomically and confirmed on chain before
  // it counts as filled, so a sell that fails cannot leave a stop-loss believed spent.
  startMonitor({
    loadOpenPositions: store.loadOpenPositions, getPrice,
    claimExit: store.claimPositionExit, settleExit: store.settlePositionExit,
    recordPendingExit: store.recordPositionExitSig, recordPeak: store.recordPositionPeak,
    recordStopBreach: store.recordStopBreach,
    // Dollar-cost averaging. Wired here or the four controls stay exactly where they have been
    // since the builder shipped: persisted, counted toward the capital the user is told to
    // fund, and never placed. The monitor no-ops without it, which is the safe default but is
    // also the defect.
    recordDcaFill: store.recordDcaFill,
    signAndSend, confirmSignature, recordTrade: store.recordTrade, onEvent: log("monitor")
  });
}

// Wallet-diff copy detection keeps its own explicit gate: detection is a holdings diff held
// in process memory, so a restart re-primes its baselines rather than resuming a cursor.
//
// The two defects that previously made this flag dangerous are fixed. It now resolves each
// subscriber's own safety filters inside the loop (store.subscriberSafety -> evaluateSafety,
// the shape that closed B-6), and every execution goes through an atomic claim that reserves
// the daily cap in the same transaction and is unique per detected buy — so a second
// instance loses the race instead of mirroring the same buy and spending the cap twice.
if (COPY_TRADING_READY) {
  startCopyWatcher({
    loadTrackedWallets: store.loadTrackedWallets, loadSubscribers: store.loadSubscribers,
    getHoldings: store.getHoldings, signAndSend,
    subscriberSafety: store.subscriberSafety,
    claimCopyExecution: store.claimCopyExecution, submitCopyExecution: store.submitCopyExecution,
    onEvent: log("copy")
  });
}

// This scanner measures source accuracy independently of whether anyone copied a call.
startPerformanceScanner({
  loadPerformanceCalls: store.loadPerformanceCalls,
  recordCallMarketScan: store.recordCallMarketScan,
  onEvent: log("performance")
});
