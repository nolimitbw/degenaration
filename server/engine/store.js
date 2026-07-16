/**
 * Data access for the engine — Supabase REST (service role) + Solana RPC, zero deps.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (server-side only, never shipped to client).
 */
// Normalize: accept the base URL even if pasted with a trailing slash or /rest/v1 suffix.
const SB = (process.env.SUPABASE_URL || "").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function sbHeaders(extra) {
  return { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra };
}
async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: sbHeaders() });
  const body = await r.json().catch(() => null);
  // PostgREST GETs return arrays; anything else is an error we must not pass downstream.
  if (!r.ok || !Array.isArray(body)) {
    console.error(`[sb] GET ${path.split("?")[0]} -> ${r.status}`, JSON.stringify(body));
    return [];
  }
  return body;
}
async function sbPatch(path, body) {
  return fetch(`${SB}/rest/v1/${path}`, { method: "PATCH", headers: sbHeaders({ prefer: "return=minimal" }), body: JSON.stringify(body) });
}
async function sbInsert(table, body) {
  return fetch(`${SB}/rest/v1/${table}`, { method: "POST", headers: sbHeaders({ prefer: "return=minimal" }), body: JSON.stringify(body) });
}

// ---- limit orders ----
const loadOpenOrders = () => sbGet("limit_orders?status=eq.open&select=*");
// Per-user trade caps (by Solana pubkey). Returns [{ max_trade_sol, daily_cap_sol }] or [].
const loadProfileCaps = async (pubkey) => {
  const privy = await sbGet(`privy_profiles?wallet_address=eq.${pubkey}&select=max_trade_sol,daily_cap_sol`);
  return privy.length ? privy : sbGet(`profiles?wallet_address=eq.${pubkey}&select=max_trade_sol,daily_cap_sol`);
};
const markFilled = (id, sig) => sbPatch(`limit_orders?id=eq.${id}`, { status: "filled", sig, filled_at: new Date().toISOString() });
const markError = (id, msg) => sbPatch(`limit_orders?id=eq.${id}`, { last_error: String(msg).slice(0, 300) });

// ---- copy trading ----
const loadTrackedWallets = async () => {
  const rows = await sbGet("copy_subscriptions?enabled=eq.true&select=leader_wallet");
  return [...new Set((rows || []).map((r) => r.leader_wallet))].map((address) => ({ address }));
};
const loadSubscribers = (wallet) => sbGet(`copy_subscriptions?enabled=eq.true&leader_wallet=eq.${wallet}&select=id,privy_user_id,user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent,tp1,tp1_sell,tp2,tp2_sell,stop_loss`);
const recordTrade = (evt) => sbInsert("trades", {
  privy_user_id: evt.privy_user_id || null,
  user_pubkey: evt.user || evt.user_pubkey || null,
  group_id: evt.group_id || null,
  mint: evt.mint,
  side: evt.side || "buy",
  sol_amount: evt.size || evt.sol_amount || null,
  fee_sol: evt.fee_sol ?? ((evt.size || evt.sol_amount) ? Number(evt.size || evt.sol_amount) * 0.02 : null),
  tx_signature: evt.sig || null,
  kind: evt.kind || "copy"
});
const recordCopy = recordTrade;
// Persist a subscription's accumulated daily spend (absolute SOL). The worker is the only
// writer, so writing the running total is safe and keeps the /tracker cap display honest.
const bumpDailySpent = (id, totalSol) => sbPatch(`copy_subscriptions?id=eq.${id}`, { daily_spent: totalSol });

// ---- discord call execution ----
const loadPendingCalls = () => sbGet("calls?executed_at=is.null&group_id=not.is.null&select=id,group_id,mint,symbol,executed_at&order=called_at.desc&limit=50");
const markCallExecuted = (id) => sbPatch(`calls?id=eq.${id}`, { executed_at: new Date().toISOString() });
const loadGroupSubscribers = (groupId) => sbGet(`subscriptions?enabled=eq.true&group_id=eq.${groupId}&select=id,privy_user_id,user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent`);
// Same writeback for group-call subscriptions so the daily cap actually throttles.
const bumpGroupSpent = (id, totalSol) => sbPatch(`subscriptions?id=eq.${id}`, { daily_spent: totalSol });

// Track calls for 30 days so every source's public score comes from the same live data.
const loadPerformanceCalls = () => {
  const since = encodeURIComponent(new Date(Date.now() - 30 * 86_400_000).toISOString());
  return sbGet(`calls?called_at=gte.${since}&select=id,mint,called_mcap,peak_mcap,latest_mcap,called_price_usd,peak_price_usd,latest_price_usd&order=called_at.desc&limit=1000`);
};
const updateCallPerformance = (id, update) => sbPatch(`calls?id=eq.${id}`, update);

// ---- on-chain holdings (for copy detection) ----
async function getHoldings(address) {
  const res = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }] })
  }).then((r) => r.json());
  const out = {};
  for (const a of res?.result?.value ?? []) {
    const info = a.account?.data?.parsed?.info;
    const amt = info?.tokenAmount?.uiAmount || 0;
    if (info?.mint && amt > 0) out[info.mint] = amt;
  }
  return out;
}

module.exports = { loadOpenOrders, loadProfileCaps, markFilled, markError, recordTrade, loadTrackedWallets, loadSubscribers, bumpDailySpent, recordCopy, getHoldings, loadPendingCalls, markCallExecuted, loadGroupSubscribers, bumpGroupSpent, loadPerformanceCalls, updateCallPerformance };
