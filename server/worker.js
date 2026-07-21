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
const signer = require("./engine/signer");
const store = require("./engine/store");

const SIGNING_READY = process.env.DELEGATED_SIGNING === "on";
const COPY_TRADING_READY = SIGNING_READY && process.env.COPY_TRADING === "on";
const NET = process.env.WORKER_NET || "mainnet";
const PORT = Number(process.env.PORT || 10000);
const startedAt = Date.now();
const state = { events: 0, errors: 0, lastEventAt: null, lastError: null };

/**
 * Sign+send a base64 tx with the user's Privy delegated session key (see engine/signer.js).
 * Gated by DELEGATED_SIGNING so the worker is watch-only until you have verified signing on
 * devnet. walletId is the Privy embedded-wallet id stored on the order/subscription.
 */
async function signAndSend(base64Tx, walletId) {
  if (!SIGNING_READY) throw new Error("delegated signing OFF (watch-only) — set DELEGATED_SIGNING=on after devnet verification");
  return signer.signAndSend(base64Tx, walletId, NET);
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
    mode: SIGNING_READY ? "live" : "watch-only",
    signingEnabled: SIGNING_READY,
    copyTradingEnabled: COPY_TRADING_READY,
    network: NET,
    feeEnabled: Boolean(process.env.PLATFORM_FEE_ACCOUNT),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    ...state
  }));
}).listen(PORT, "0.0.0.0", () => console.log(`[worker] health listening on :${PORT}`));

if (SIGNING_READY) {
  startLimitWatcher({
    loadOpenOrders: store.loadOpenOrders, getPrice, signAndSend,
    claimOrder: store.claimLimitOrder, finishOrder: store.finishLimitOrder,
    recordTrade: store.recordTrade, onEvent: log("limit")
  });

  // Discord group calls -> mirror to each group's subscribers.
  startCallWatcher({
    loadPendingCalls: store.loadPendingCalls, loadGroupSubscribers: store.loadGroupSubscribers,
    claimCallExecution: store.claimCallExecution, finishCallExecution: store.finishCallExecution,
    completeCall: store.completeCall, markCallExecuted: store.markCallExecuted, signAndSend,
    recordCopy: store.recordCopy, onEvent: log("call")
  });
}

// Wallet-diff copy detection needs its own explicit gate until transaction cursors are durable.
if (COPY_TRADING_READY) {
  startCopyWatcher({
    loadTrackedWallets: store.loadTrackedWallets, loadSubscribers: store.loadSubscribers,
    getHoldings: store.getHoldings, signAndSend, bumpDailySpent: store.bumpDailySpent,
    recordCopy: store.recordCopy, onEvent: log("copy")
  });
}

// This scanner measures source accuracy independently of whether anyone copied a call.
startPerformanceScanner({
  loadPerformanceCalls: store.loadPerformanceCalls,
  updateCallPerformance: store.updateCallPerformance,
  onEvent: log("performance")
});
