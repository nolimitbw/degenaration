/**
 * Data access for the engine — Supabase REST (service role) + Solana RPC, zero deps.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (server-side only, never shipped to client).
 */
// Normalize: accept the base URL even if pasted with a trailing slash or /rest/v1 suffix.
const SB = (process.env.SUPABASE_URL || "").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const { platformFeeSol } = require("./jupiter");
const REQUEST_TIMEOUT_MS = 10_000;

function sbHeaders(extra) {
  return { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra };
}
async function sbGet(path, strict = false) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: sbHeaders(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await r.json().catch(() => null);
  // PostgREST GETs return arrays; anything else is an error we must not pass downstream.
  if (!r.ok || !Array.isArray(body)) {
    console.error(`[sb] GET ${path.split("?")[0]} -> ${r.status}`, JSON.stringify(body));
    if (strict) throw new Error(`Supabase GET ${path.split("?")[0]} failed (${r.status})`);
    return [];
  }
  return body;
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method: "PATCH", headers: sbHeaders({ prefer: "return=minimal" }), body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Supabase PATCH ${path.split("?")[0]} failed (${r.status})`);
}
async function sbInsert(table, body) {
  const r = await fetch(`${SB}/rest/v1/${table}`, { method: "POST", headers: sbHeaders({ prefer: "return=minimal" }), body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Supabase INSERT ${table} failed (${r.status})`);
}
async function sbRpc(name, body) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: sbHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Supabase RPC ${name} failed (${r.status})`);
  return data;
}

// ---- limit orders ----
const loadOpenOrders = () => sbGet("limit_orders?status=eq.open&select=*", true);
const claimLimitOrder = (id) => sbRpc("worker_claim_limit_order", { p_id: id });
const finishLimitOrder = (id, claimToken, status, sig, error) => sbRpc("worker_finish_limit_order", {
  p_id: id,
  p_claim_token: claimToken,
  p_status: status,
  p_sig: sig || null,
  p_error: error || null
});

// ---- copy trading ----
const loadTrackedWallets = async () => {
  const rows = await sbGet("copy_subscriptions?enabled=eq.true&select=leader_wallet", true);
  return [...new Set((rows || []).map((r) => r.leader_wallet))].map((address) => ({ address }));
};
const loadSubscribers = (wallet) => sbGet(`copy_subscriptions?enabled=eq.true&leader_wallet=eq.${wallet}&select=id,privy_user_id,user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent,tp1,tp1_sell,tp2,tp2_sell,stop_loss`, true);

/**
 * A subscriber's own safety filters, or null when the row predates the bot builder.
 *
 * `extended_config` is the full bot config written at save time, so no extra round trip
 * and no cross-schema read of app_private.bot_config_versions is needed.
 *
 * Returns `{ ok: false }` when the row came from the builder (it has a bot_profile_id or a
 * config_version_id) but its filters cannot be read. Callers MUST treat that as a refusal
 * to execute rather than as "no filters configured" — silently running a bot without the
 * user's risk settings is the failure this guards against.
 */
function subscriberSafety(subscription) {
  const row = subscription || {};
  const fromBuilder = Boolean(row.bot_profile_id || row.config_version_id);
  const config = row.extended_config;

  if (config && typeof config === "object" && config.safetyFilters && typeof config.safetyFilters === "object") {
    return { ok: true, safety: config.safetyFilters, fromBuilder };
  }
  if (fromBuilder) {
    return { ok: false, reason: "bot safety configuration unavailable", fromBuilder };
  }
  // Legacy subscription with no builder config: platform baseline checks still applied.
  return { ok: true, safety: null, fromBuilder: false };
}
const recordTrade = (evt) => sbInsert("trades", {
  privy_user_id: evt.privy_user_id || null,
  user_pubkey: evt.user || evt.user_pubkey || null,
  group_id: evt.group_id || null,
  mint: evt.mint,
  side: evt.side || "buy",
  sol_amount: evt.size || evt.sol_amount || null,
  fee_sol: evt.fee_sol ?? platformFeeSol(evt.size || evt.sol_amount),
  tx_signature: evt.sig || null,
  kind: evt.kind || "copy"
});
const recordCopy = recordTrade;
// Persist a subscription's accumulated daily spend (absolute SOL). The worker is the only
// writer, so writing the running total is safe and keeps the /tracker cap display honest.
const bumpDailySpent = (id, totalSol) => sbPatch(`copy_subscriptions?id=eq.${id}`, { daily_spent: totalSol });

// ---- discord call execution ----
const loadPendingCalls = () => sbGet("calls?executed_at=is.null&group_id=not.is.null&select=id,group_id,mint,symbol,executed_at&order=called_at.desc&limit=50", true);
const markCallExecuted = (id) => sbPatch(`calls?id=eq.${id}`, { executed_at: new Date().toISOString() });
const loadGroupSubscribers = (groupId) => sbGet(`subscriptions?enabled=eq.true&group_id=eq.${groupId}&select=id,privy_user_id,user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent,bot_profile_id,config_version_id,extended_config`, true);
const claimCallExecution = (callId, subscriptionId) => sbRpc("worker_claim_call_execution", {
  p_call_id: callId,
  p_subscription_id: subscriptionId
});
const finishCallExecution = (callId, subscriptionId, claimToken, status, sig, error) => sbRpc("worker_finish_call_execution", {
  p_call_id: callId,
  p_subscription_id: subscriptionId,
  p_claim_token: claimToken,
  p_status: status,
  p_sig: sig || null,
  p_error: error || null
});
const completeCall = (callId) => sbRpc("worker_complete_call", { p_call_id: callId });

// Submission is recorded separately from settlement: a signature exists, but whether it
// landed is not known yet. engine/settlement.js resolves these against the chain.
const submitCallExecution = (callId, subscriptionId, claimToken, sig) => sbRpc("worker_submit_call_execution", {
  p_call_id: callId, p_subscription_id: subscriptionId, p_claim_token: claimToken, p_sig: sig
});
const loadSubmittedExecutions = async () => {
  const res = await sbRpc("worker_load_submitted_executions", { p_limit: 100 });
  return res?.executions || [];
};
const settleCallExecution = (callId, subscriptionId, claimToken, status, error) => sbRpc("worker_settle_call_execution", {
  p_call_id: callId, p_subscription_id: subscriptionId, p_claim_token: claimToken,
  p_status: status, p_error: error || null
});

// Track calls for 30 days so every source's public score comes from the same live data.
const loadPerformanceCalls = () => {
  const since = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
  return sbGet(`calls?called_at=gte.${since}&select=id,mint,called_mcap,peak_mcap,latest_mcap,called_price_usd,peak_price_usd,latest_price_usd&order=called_at.desc&limit=1000`);
};
const updateCallPerformance = (id, update) => sbPatch(`calls?id=eq.${id}`, update);

// ---- positions (TP/SL exit path) ----
//
// `loadOpenPositions` existing is also what retires the worker's start-up refusal guard:
// worker.js will not boot with signing enabled while the worker has no way to exit a
// position. Do not rename it without reading that guard.
const loadOpenPositions = () => sbGet(
  "positions?status=in.(open,exiting)&select=id,user_pubkey,wallet_id,privy_user_id,group_id,mint,entry_price_usd,amount_raw,original_amount_raw,tp1,tp1_sell,tp2,tp2_sell,stop_loss,slippage_bps,filled_tp1,filled_tp2,status,pending_exit_kind,pending_exit_sig,pending_exit_amount_raw,pending_exit_claim_token,pending_exit_at,exit_attempts&order=created_at.asc&limit=500",
  true
);

/** Capture a filled buy as an open position. Idempotent on the entry signature. */
const openPosition = (position) => sbRpc("worker_open_position", {
  p_user_pubkey: position.userPubkey,
  p_wallet_id: position.walletId || null,
  p_mint: position.mint,
  p_entry_price_usd: position.entryPriceUsd,
  p_amount_raw: position.amountRaw,
  p_entry_sig: position.entrySig,
  p_slippage_bps: position.slippageBps ?? 300,
  p_tp1: position.tp1 ?? null,
  p_tp1_sell: position.tp1Sell ?? 0,
  p_tp2: position.tp2 ?? null,
  p_tp2_sell: position.tp2Sell ?? 0,
  p_stop_loss: position.stopLoss ?? null,
  p_privy_user_id: position.privyUserId || null,
  p_group_id: position.groupId || null,
  p_user_id: position.userId || null
});

const claimPositionExit = (id, kind, amountRaw) => sbRpc("worker_claim_position_exit", {
  p_id: id, p_kind: kind, p_amount_raw: amountRaw
});
const recordPositionExitSig = (id, claimToken, sig) => sbRpc("worker_record_position_exit_sig", {
  p_id: id, p_claim_token: claimToken, p_sig: sig
});
const settlePositionExit = (id, claimToken, settlement) => sbRpc("worker_settle_position_exit", {
  p_id: id,
  p_claim_token: claimToken,
  p_status: settlement.status,
  p_amount_raw: settlement.amountRaw,
  p_filled_tp1: settlement.filledTp1,
  p_filled_tp2: settlement.filledTp2,
  p_attempts: settlement.attempts,
  p_error: settlement.error || null
});

// ---- on-chain holdings (for copy detection) ----
async function getHoldings(address) {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }] }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }).then((r) => r.json());
  const out = {};
  for (const a of res?.result?.value ?? []) {
    const info = a.account?.data?.parsed?.info;
    const amt = info?.tokenAmount?.uiAmount || 0;
    if (info?.mint && amt > 0) out[info.mint] = amt;
  }
  return out;
}

module.exports = { subscriberSafety, loadOpenOrders, claimLimitOrder, finishLimitOrder, recordTrade, loadTrackedWallets, loadSubscribers, bumpDailySpent, recordCopy, getHoldings, loadPendingCalls, markCallExecuted, loadGroupSubscribers, claimCallExecution, finishCallExecution, completeCall, loadPerformanceCalls, updateCallPerformance, loadOpenPositions, openPosition, claimPositionExit, recordPositionExitSig, settlePositionExit, submitCallExecution, loadSubmittedExecutions, settleCallExecution };
