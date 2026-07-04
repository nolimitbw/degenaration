/**
 * DEGENARATION automation worker — runs the limit-order + copy-trade watchers 24/7.
 *   node worker.js
 *
 * NON-CUSTODIAL: execution requires DELEGATED session-key signing (Privy). Until that is
 * wired in `signAndSend` below, the worker WATCHES and logs triggers but refuses to send
 * a transaction — so it can never move funds by accident. See GO-LIVE Phase A/E.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, MAINNET_RPC (paid recommended),
 *      PLATFORM_FEE_ACCOUNT (optional 2% fee), PRIVY_APP_ID/PRIVY_APP_SECRET (for signing).
 */
require("dotenv").config();
const { getPrice } = require("./engine/prices");
const { startLimitWatcher } = require("./engine/limits");
const { startCopyWatcher } = require("./engine/copy");
const { startCallWatcher } = require("./engine/calls");
const signer = require("./engine/signer");
const store = require("./engine/store");

const SIGNING_READY = process.env.DELEGATED_SIGNING === "on";
const NET = process.env.WORKER_NET || "mainnet";

/**
 * Sign+send a base64 tx with the user's Privy delegated session key (see engine/signer.js).
 * Gated by DELEGATED_SIGNING so the worker is watch-only until you have verified signing on
 * devnet. walletId is the Privy embedded-wallet id stored on the order/subscription.
 */
async function signAndSend(base64Tx, walletId) {
  if (!SIGNING_READY) throw new Error("delegated signing OFF (watch-only) — set DELEGATED_SIGNING=on after devnet verification");
  return signer.signAndSend(base64Tx, walletId, NET);
}

function log(tag) { return (e) => console.log(`[${tag}]`, JSON.stringify(e)); }

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("[worker] missing SUPABASE_URL / SUPABASE_SERVICE_KEY — cannot load orders. Exiting.");
  process.exit(1);
}

console.log(`[worker] starting — signing ${SIGNING_READY ? "ENABLED" : "DISABLED (watch-only)"}`);

startLimitWatcher({
  loadOpenOrders: store.loadOpenOrders, getPrice, signAndSend,
  markFilled: store.markFilled, markError: store.markError, onEvent: log("limit")
});

startCopyWatcher({
  loadTrackedWallets: store.loadTrackedWallets, loadSubscribers: store.loadSubscribers,
  getHoldings: store.getHoldings, signAndSend, recordCopy: store.recordCopy, onEvent: log("copy")
});

// Discord group calls -> mirror to each group's subscribers.
startCallWatcher({
  loadPendingCalls: store.loadPendingCalls, loadGroupSubscribers: store.loadGroupSubscribers,
  markCallExecuted: store.markCallExecuted, signAndSend, recordCopy: store.recordCopy, onEvent: log("call")
});
