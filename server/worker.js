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
const { timingSafeEqual, createHash } = require("crypto");
const { getPrice } = require("./engine/prices");
const { startLimitWatcher } = require("./engine/limits");
const { startCopyWatcher } = require("./engine/copy");
const { startCallWatcher } = require("./engine/calls");
const { createCallDispatcher } = require("./engine/call-stream");
const { startPerformanceScanner } = require("./engine/performance");
const signer = require("./engine/signer");
const store = require("./engine/store");

const SIGNING_READY = process.env.DELEGATED_SIGNING === "on";
const COPY_TRADING_READY = SIGNING_READY && process.env.COPY_TRADING === "on";
const NET = String(process.env.WORKER_NET || "").trim().toLowerCase();
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

// Calls the site has just journaled are pushed here so execution happens on the call
// rather than on the next poll tick. Shared with the poll backstop below.
const dispatchSeen = new Set();
let dispatchCall = null;

const BOT_SECRET = process.env.BOT_SHARED_SECRET || "";
function dispatchAuthorized(req) {
  const supplied = req.headers["x-bot-secret"];
  if (!BOT_SECRET || typeof supplied !== "string" || !supplied) return false;
  const digest = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(BOT_SECRET), digest(supplied));
}

function readJsonBody(req, limitBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/dispatch") {
    if (!dispatchAuthorized(req)) return sendJson(res, 401, { error: "unauthorized" });
    if (!dispatchCall) return sendJson(res, 503, { error: "call execution is not running" });
    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendJson(res, 400, { error: e.message }); }
    const callId = typeof body?.callId === "string" ? body.callId : null;
    if (!callId) return sendJson(res, 400, { error: "call id required" });
    // Acknowledge immediately — the site must never wait on our Jupiter round-trips.
    sendJson(res, 202, { accepted: true, callId });
    dispatchCall(callId).catch((e) => console.error("[worker] dispatch failed:", e.message));
    return;
  }

  if (req.url !== "/" && req.url !== "/health") return sendJson(res, 404, { error: "not found" });

  sendJson(res, 200, {
    status: "ok",
    mode: SIGNING_READY ? "live" : "watch-only",
    signingEnabled: SIGNING_READY,
    copyTradingEnabled: COPY_TRADING_READY,
    callDispatchEnabled: Boolean(dispatchCall && BOT_SECRET),
    network: NET,
    feeEnabled: Boolean(process.env.PLATFORM_FEE_ACCOUNT),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    ...state
  });
}).listen(PORT, "0.0.0.0", () => console.log(`[worker] health listening on :${PORT}`));

if (SIGNING_READY) {
  startLimitWatcher({
    loadOpenOrders: store.loadOpenOrders, getPrice, signAndSend,
    claimOrder: store.claimLimitOrder, finishOrder: store.finishLimitOrder,
    recordTrade: store.recordTrade, onEvent: log("limit")
  });

  // Discord group calls -> mirror to each group's subscribers.
  const callDeps = {
    loadPendingCalls: store.loadPendingCalls, loadCallById: store.loadCallById,
    loadGroupSubscribers: store.loadGroupSubscribers,
    claimCallExecution: store.claimCallExecution, finishCallExecution: store.finishCallExecution,
    completeCall: store.completeCall, markCallExecuted: store.markCallExecuted, signAndSend,
    recordCopy: store.recordCopy, onEvent: log("call"), seen: dispatchSeen
  };

  // Primary trigger: the site pushes each journaled call to POST /dispatch.
  dispatchCall = createCallDispatcher(callDeps);
  if (!BOT_SECRET) console.warn("[worker] BOT_SHARED_SECRET not set — push dispatch disabled, falling back to the poll");

  // Backstop for anything the push missed.
  startCallWatcher(callDeps);
}

// Wallet-diff copy detection needs its own explicit gate until transaction cursors are durable.
if (COPY_TRADING_READY) {
  startCopyWatcher({
    loadTrackedWallets: store.loadTrackedWallets, loadSubscribers: store.loadSubscribers,
    getHoldings: store.getHoldings, signAndSend, bumpDailySpent: store.bumpDailySpent,
    recordCopy: store.recordCopy, onEvent: log("copy")
  });
}

// These scanners measure source accuracy independently of whether anyone copied a call.
// Young calls move fastest, so they get a tight loop; the 30-day tail gets a slow one.
startPerformanceScanner({
  loadPerformanceCalls: store.loadFreshPerformanceCalls,
  updateCallPerformance: store.updateCallPerformance,
  onEvent: log("performance")
}, 30_000);

startPerformanceScanner({
  loadPerformanceCalls: store.loadPerformanceCalls,
  updateCallPerformance: store.updateCallPerformance,
  onEvent: log("performance-tail")
}, 900_000);
