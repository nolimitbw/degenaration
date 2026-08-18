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

/**
 * Tell the database this worker is alive.
 *
 * `public.worker_heartbeat` has been deployed since degenaration-product-rpcs.sql and had
 * NEVER been called. So `app_private.worker_leases` held zero rows while the worker ran, and
 * one status document read that zero as proof the worker had never started — an empty table
 * treated as a measurement, which is worse than an empty table.
 *
 * Failure here must never stop trading: a heartbeat is a report, and a worker that cannot
 * report is still a worker that can exit an open position. The caller swallows the error and
 * counts it.
 */
const workerHeartbeat = (instanceId, executionMode, leaseSeconds, metadata) => sbRpc("worker_heartbeat", {
  p_worker_key: "trading-worker",
  p_instance_id: instanceId,
  p_execution_mode: executionMode,
  p_lease_seconds: leaseSeconds,
  p_metadata: metadata
});

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
// DEPLOY ORDER: kill_switch, subscriber_config_version_id and subscriber_config_snapshot
// come from supabase/degenaration-subscriber-config-versioning.sql. PostgREST answers a
// select naming an unknown column with 400, so that migration MUST be applied before this
// worker build runs. It is not applied yet — see docs/ai/OPEN_BLOCKERS.md E-1.
//
// `extended_config` carries the subscriber's own safety filters, which this path previously
// could not honour because the column did not exist on this table.
const loadSubscribers = (wallet) => sbGet(`copy_subscriptions?enabled=eq.true&kill_switch=eq.false&leader_wallet=eq.${wallet}&select=id,privy_user_id,user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent,tp1,tp1_sell,tp2,tp2_sell,stop_loss,extended_config,subscriber_config_version_id,subscriber_config_snapshot`, true);

/**
 * A subscriber's own safety filters, or null when the row predates the bot builder.
 *
 * Versioned rows read the snapshot copied beside their immutable version pointer. Legacy
 * rows use an explicit compatibility marker rather than falling through as empty config.
 *
 * Returns `{ ok: false }` when a versioned row or builder row has no readable filters.
 * Callers MUST treat that as a refusal
 * to execute rather than as "no filters configured" — silently running a bot without the
 * user's risk settings is the failure this guards against.
 */
function subscriberSafety(subscription) {
  const row = subscription || {};
  const versioned = Boolean(row.subscriber_config_version_id);
  const fromBuilder = Boolean(row.bot_profile_id || row.config_version_id || versioned);
  // The snapshot column is NOT NULL DEFAULT '{}', so an unversioned row carries an empty
  // object, and `{}` is truthy. Falling back on truthiness would let that empty default
  // shadow a real extended_config and run a configured bot with NO filters at all —
  // exactly the bypass the ok/false guard below exists to prevent.
  const snapshot = row.subscriber_config_snapshot;
  const hasSnapshot = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length > 0;
  const config = hasSnapshot ? snapshot : row.extended_config;

  if (versioned && config?.compatibilityMode === "legacy-baseline") {
    return { ok: true, safety: null, fromBuilder: false, compatibilityMode: "legacy-baseline" };
  }

  if (config && typeof config === "object" && config.safetyFilters && typeof config.safetyFilters === "object") {
    return { ok: true, safety: config.safetyFilters, fromBuilder };
  }
  if (fromBuilder) {
    return { ok: false, reason: "bot safety configuration unavailable", fromBuilder };
  }
  // Legacy subscription with no builder config: platform baseline checks still applied.
  return { ok: true, safety: null, fromBuilder: false };
}
/**
 * The subscriber's own execution policy — priority fee and quote freshness.
 *
 * Resolved from the SAME snapshot `subscriberSafety` reads, deliberately: two resolvers over
 * two sources is how the filters and the limits would drift apart, and the immutable snapshot
 * is the configuration the trade is authorised under.
 *
 * Returns null when there is nothing configured, which the engine reads as "use the platform
 * default". That is not the same as returning zeros: a zero priority-fee cap would mean paying
 * nothing, and a zero quote window would expire every quote before it could be submitted.
 */
function subscriberExecution(subscription) {
  const row = subscription || {};
  const snapshot = row.subscriber_config_snapshot;
  const hasSnapshot = snapshot && typeof snapshot === "object" && Object.keys(snapshot).length > 0
    && snapshot.compatibilityMode !== "legacy-baseline";
  const config = hasSnapshot ? snapshot : row.extended_config;
  if (!config || typeof config !== "object") return null;

  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  // The switch layer. `limits.priorityFee = false` means the owner turned the cap off, which
  // is not the same as a cap of zero: off falls back to the aggregator's own policy, zero would
  // build a transaction that never lands. Absent reads as on.
  const limits = config.limits && typeof config.limits === "object" ? config.limits : {};
  const priorityFeeMaxLamports = limits.priorityFee === false ? null : number(config.priorityFeeMaxLamports);
  const quoteExpirationSeconds = number(config.quoteExpirationSeconds);
  // Absent reads as ON, matching the builder default and every other safety control here.
  // The DEFAULT lives at the call site — guardWithSimulation treats an undefined `required` as
  // true — so this resolver keeps its existing contract: null means "nothing to say", and a bot
  // that changed nothing does not become a configured bot just by having a default.
  const simulationRequired = config.simulationRequired !== false;
  const autoRetryCount = number(config.autoRetryCount);
  if (priorityFeeMaxLamports === null && quoteExpirationSeconds === null
    && simulationRequired && autoRetryCount === null) {
    return null;
  }
  return {
    priorityFeeMaxLamports,
    priorityFeeStrategy: typeof config.priorityFeeStrategy === "string" ? config.priorityFeeStrategy : "auto",
    quoteExpirationSeconds,
    simulationRequired,
    autoRetryCount
  };
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
// called_at is selected because the watcher REFUSES a stale call. Omitted, the freshness
// bound reads undefined, computes an age of zero, and silently never fires — a guard that
// looks present and protects nothing.
const loadPendingCalls = () => sbGet("calls?executed_at=is.null&group_id=not.is.null&select=id,group_id,mint,symbol,executed_at,called_at&order=called_at.desc&limit=50", true);
const markCallExecuted = (id) => sbPatch(`calls?id=eq.${id}`, { executed_at: new Date().toISOString() });
const loadGroupSubscribers = (groupId) => sbGet(`subscriptions?enabled=eq.true&kill_switch=eq.false&group_id=eq.${groupId}&select=id,privy_user_id,user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent,bot_profile_id,config_version_id,extended_config,subscriber_config_version_id,subscriber_config_snapshot`, true);
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

// ---- copy-trade executions ----
const claimCopyExecution = (subscriptionId, leaderWallet, mint, key) => sbRpc("worker_claim_copy_execution", {
  p_subscription_id: subscriptionId, p_leader_wallet: leaderWallet, p_mint: mint, p_dedupe_key: key
});
const submitCopyExecution = (subscriptionId, key, claimToken, sig) => sbRpc("worker_submit_copy_execution", {
  p_subscription_id: subscriptionId, p_dedupe_key: key, p_claim_token: claimToken, p_sig: sig
});
const settleCopyExecution = (subscriptionId, key, claimToken, status, error) => sbRpc("worker_settle_copy_execution", {
  p_subscription_id: subscriptionId, p_dedupe_key: key, p_claim_token: claimToken,
  p_status: status, p_error: error || null
});

/**
 * One reconciler handles both execution sources, so it settles through this dispatcher
 * rather than knowing which table a row came from. `source` is supplied by
 * worker_load_submitted_executions.
 */
const settleExecution = (execution, status, error) => execution.source === "copy"
  ? settleCopyExecution(execution.subscription_id, execution.dedupe_key, execution.claim_token, status, error)
  : settleCallExecution(execution.call_id, execution.subscription_id, execution.claim_token, status, error);

// Track calls for 30 days so every source's public score comes from the same live data.
const loadPerformanceCalls = () => {
  const since = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
  return sbGet(`calls?called_at=gte.${since}&deleted_at=is.null&parse_status=eq.accepted&select=id,mint&order=called_at.desc&limit=1000`);
};
const recordCallMarketScan = (id, quote) => sbRpc("worker_record_call_market_scan", {
  p_call_id: id,
  p_provider: quote?.provider || "dexscreener",
  p_observed_at: quote?.observedAt || new Date().toISOString(),
  p_price_usd: quote?.priceUsd ?? null,
  p_market_cap_usd: quote?.marketCap ?? null,
  p_liquidity_usd: quote?.liquidityUsd ?? null,
  p_freshness: quote?.freshness || "unavailable"
});

// ---- positions (TP/SL exit path) ----
//
// `loadOpenPositions` existing is also what retires the worker's start-up refusal guard:
// worker.js will not boot with signing enabled while the worker has no way to exit a
// position. Do not rename it without reading that guard.
const loadOpenPositions = () => sbGet(
  "positions?status=in.(open,exiting)&select=id,user_pubkey,wallet_id,privy_user_id,group_id,mint,entry_price_usd,amount_raw,original_amount_raw,tp1,tp1_sell,tp2,tp2_sell,stop_loss,slippage_bps,filled_tp1,filled_tp2,entry_config,peak_price_usd,filled_levels,filled_dca_levels,created_at,stop_breached_at,status,pending_exit_kind,pending_exit_sig,pending_exit_amount_raw,pending_exit_claim_token,pending_exit_at,exit_attempts&order=created_at.asc&limit=500",
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
  p_user_id: position.userId || null,
  // The exit plan this position is bound to for its whole life. Controller section 3
  // requires the trade to store the configuration snapshot it was opened under, and the
  // worker's own ledger had nowhere to keep it.
  p_entry_config: position.entryConfig || {}
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
  p_error: settlement.error || null,
  p_filled_levels: settlement.filledLevels ?? null
});

/**
 * Arm or clear the durable stop-delay clock.
 *
 * Idempotent on the arming side in SQL — `coalesce(stop_breached_at, now())` — so a monitor
 * ticking every few seconds cannot keep pushing the deadline away and stop the stop from ever
 * firing. That is the whole reason the decision lives in the database rather than here.
 */
/**
 * Record a DCA fill and add its purchase to the position, in one statement.
 *
 * Marking the level and growing the position are the same fact. Split across two calls there
 * is a window where the level is marked and the tokens are not counted — the position
 * under-reports what it holds and the next exit undersells — or the reverse, and the next tick
 * buys the level again.
 */
const recordDcaFill = (id, level, amountRaw, fillPriceUsd, sig) => sbRpc("worker_record_dca_fill", {
  p_id: id, p_level: level, p_amount_raw: amountRaw, p_fill_price_usd: fillPriceUsd, p_sig: sig
});

const recordStopBreach = (id, breached) => sbRpc("worker_record_stop_breach", {
  p_id: id, p_breached: Boolean(breached)
});

/** Raise the high-water mark. Monotonic in SQL, so an out-of-order tick cannot lower it. */
const recordPositionPeak = (id, price) => sbRpc("worker_record_position_peak", {
  p_id: id, p_price: price
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

module.exports = { workerHeartbeat, recordDcaFill, subscriberSafety, subscriberExecution, loadOpenOrders, claimLimitOrder, finishLimitOrder, recordTrade, loadTrackedWallets, loadSubscribers, bumpDailySpent, recordCopy, getHoldings, loadPendingCalls, markCallExecuted, loadGroupSubscribers, claimCallExecution, finishCallExecution, completeCall, loadPerformanceCalls, recordCallMarketScan, loadOpenPositions, openPosition, claimPositionExit, recordPositionExitSig, settlePositionExit, recordPositionPeak, recordStopBreach, submitCallExecution, loadSubmittedExecutions, settleCallExecution, claimCopyExecution, submitCopyExecution, settleCopyExecution, settleExecution };
