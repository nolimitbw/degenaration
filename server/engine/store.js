/**
 * Data access for the engine — Supabase REST (service role) + Solana RPC, zero deps.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (server-side only, never shipped to client).
 */
const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RPC = process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function sbHeaders(extra) {
  return { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra };
}
async function sbGet(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.json();
}
async function sbPatch(path, body) {
  return fetch(`${SB}/rest/v1/${path}`, { method: "PATCH", headers: sbHeaders({ prefer: "return=minimal" }), body: JSON.stringify(body) });
}
async function sbInsert(table, body) {
  return fetch(`${SB}/rest/v1/${table}`, { method: "POST", headers: sbHeaders({ prefer: "return=minimal" }), body: JSON.stringify(body) });
}

// ---- limit orders ----
const loadOpenOrders = () => sbGet("limit_orders?status=eq.open&select=*");
const markFilled = (id, sig) => sbPatch(`limit_orders?id=eq.${id}`, { status: "filled", sig, filled_at: new Date().toISOString() });
const markError = (id, msg) => sbPatch(`limit_orders?id=eq.${id}`, { last_error: String(msg).slice(0, 300) });

// ---- copy trading ----
const loadTrackedWallets = async () => {
  const rows = await sbGet("copy_subscriptions?enabled=eq.true&select=leader_wallet");
  return [...new Set((rows || []).map((r) => r.leader_wallet))].map((address) => ({ address }));
};
const loadSubscribers = (wallet) => sbGet(`copy_subscriptions?enabled=eq.true&leader_wallet=eq.${wallet}&select=user_pubkey,wallet_id,size_sol,slippage_bps,daily_cap_sol,daily_spent`);
const recordCopy = (evt) => sbInsert("trades", { mint: evt.mint, side: "buy", sol_amount: evt.size, kind: "copy", sig: evt.sig, wallet_address: evt.user });

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

module.exports = { loadOpenOrders, markFilled, markError, loadTrackedWallets, loadSubscribers, recordCopy, getHoldings };
