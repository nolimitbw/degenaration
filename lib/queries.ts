import { supabase } from "./supabase";
import { fetchWithTimeout, sanitizeError } from "./server/guard";

export type Group = {
  id: string;
  name: string;
  members: string | null;
  win_rate: number | null;
  pnl_30d: string | null;
  tag: string | null;
};

// Demo rows seeded by an old schema migration — never actually approved as call
// groups. RLS blocks the anon key from deleting them (correctly), so they're
// filtered here until the owner runs supabase/cleanup-demo-groups.sql. Matched
// by row id, not name — a name match would also hide a future real group that
// happens to share one of these (fairly generic) display names.
const UNVERIFIED_DEMO_GROUP_IDS = new Set([
  "4184172f-fc9b-4812-b824-47b47803e98c", // "Alpha Trenches"
  "d190319f-215e-418a-bf2b-379cf02027ad", // "Solana Snipers"
  "63873a8c-a247-45cc-8b9a-ccf01a2d0437", // "Pump Scouts"
  "2453d26f-107b-40ff-8771-3991e8869dc6"  // "Degen Central"
]);

/** Approved call groups for the public Calls page. Falls back to [] if DB not reachable. */
export async function getApprovedGroups(): Promise<Group[]> {
  const { data, error } = await supabase
    .from("approved_groups")
    .select("id,name,members,win_rate,pnl_30d,tag")
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []).filter((g) => !UNVERIFIED_DEMO_GROUP_IDS.has(g.id));
}

/** Submit a server-listing application from the /apply page. */
export async function submitApplication(input: {
  server_name: string;
  invite_link: string;
  owner_handle: string;
  member_count: string;
  pitch: string;
}) {
  return supabase.from("server_applications").insert(input);
}

// ---- user-scoped data (RLS enforces ownership) ----

export type Subscription = {
  group_id: string; size_sol: number; tp1: number; tp1_sell: number;
  tp2: number; tp2_sell: number; stop_loss: number; slippage_bps: number;
  daily_cap_sol: number; enabled: boolean;
  user_pubkey?: string; wallet_id?: string;
};

export async function getMySubscriptions(): Promise<Subscription[]> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("group_id,size_sol,tp1,tp1_sell,tp2,tp2_sell,stop_loss,slippage_bps,daily_cap_sol,enabled");
  if (error) return [];
  return data ?? [];
}

/** Upsert a per-group subscription for the signed-in user. */
export async function saveSubscription(sub: Partial<Subscription> & { group_id: string }) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { error: { message: "not signed in" } };
  return supabase.from("subscriptions").upsert(
    { user_id: uid, ...sub },
    { onConflict: "user_id,group_id" }
  );
}

export type Trade = {
  id: string; mint: string; side: string; sol_amount: number | null;
  price_usd: number | null; fee_sol: number | null; kind: string | null; created_at: string;
};

export async function getMyTrades(): Promise<Trade[]> {
  const { data, error } = await supabase
    .from("trades")
    .select("id,mint,side,sol_amount,price_usd,fee_sol,kind,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return [];
  return data ?? [];
}

/** Live price + rug-check helpers that call our API routes. */
export async function fetchPrice(mint: string) {
  return fetchWithTimeout(`/api/price?mint=${mint}`).then((r) => r.json()).catch(() => null);
}
export async function fetchRugcheck(mint: string) {
  return fetchWithTimeout(`/api/rugcheck?mint=${mint}`).then((r) => r.json()).catch(() => null);
}

// ---- admin ----

export type Application = {
  id: string; server_name: string; invite_link: string; owner_handle: string;
  member_count: string | null; pitch: string | null; status: string; created_at: string;
};

export async function getApplications(): Promise<Application[]> {
  const { data, error } = await supabase
    .from("server_applications")
    .select("id,server_name,invite_link,owner_handle,member_count,pitch,status,created_at")
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Approve: mark application approved AND publish it to approved_groups. */
export async function approveApplication(app: Application) {
  await supabase.from("server_applications").update({ status: "approved" }).eq("id", app.id);
  return supabase.from("approved_groups").insert({
    name: app.server_name,
    members: app.member_count,
    win_rate: null,
    pnl_30d: null,
    tag: "New",
    active: true
  });
}

export async function rejectApplication(id: string) {
  return supabase.from("server_applications").update({ status: "rejected" }).eq("id", id);
}

// ---- profile (trade limits) ----

export type Profile = { wallet_address: string | null; max_trade_sol: number; daily_cap_sol: number; risk_accepted: boolean; quick_buy_amounts: number[] };

export async function getMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return null;
  const { data } = await supabase
    .from("profiles")
    .select("wallet_address,max_trade_sol,daily_cap_sol,risk_accepted,quick_buy_amounts")
    .eq("id", uid)
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function saveProfileLimits(limits: Partial<{ max_trade_sol: number; daily_cap_sol: number; wallet_address: string; quick_buy_amounts: number[] }>) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { error: { message: "not signed in" } };
  return supabase.from("profiles").update(limits).eq("id", uid);
}

// ---- admin commissions ----

export async function getCommissionTotals() {
  // sum of the 2% fees the platform earned, from the trades table
  const { data, error } = await supabase.from("trades").select("fee_sol");
  if (error) return { totalSol: 0, count: 0 };
  const rows = data ?? [];
  const totalSol = rows.reduce((s: number, r: any) => s + (Number(r.fee_sol) || 0), 0);
  return { totalSol, count: rows.length };
}

export async function fetchBalance(address: string, net?: string) {
  const q = net ? `&net=${net}` : "";
  return fetchWithTimeout(`/api/balance?address=${address}${q}`).then((r) => r.json()).catch(() => null);
}

// ---- real on-chain portfolio (SPL holdings priced live) ----
export type Position = {
  mint: string; amount: number; symbol: string | null; name: string | null; image: string | null;
  priceUsd: number | null; valueUsd: number | null; change24h: number | null; liquidityUsd: number | null;
};
export type Portfolio = {
  address: string; sol: number; solPrice: number; solUsd: number;
  positions: Position[]; tokenUsd: number; totalUsd: number; count: number;
};
export async function fetchPortfolio(address: string, net?: string): Promise<Portfolio | null> {
  const q = net ? `&net=${net}` : "";
  return fetchWithTimeout(`/api/portfolio?address=${address}${q}`).then((r) => r.json()).catch(() => null);
}
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  if (n >= 1) return "$" + n.toFixed(2);
  return "$" + n.toFixed(4);
}
export function fmtAmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

// ---- limit orders (persisted to Supabase; the 24/7 worker executes them) ----
export type DbLimitOrder = {
  id: string; mint: string; symbol: string | null; trigger: "below" | "above";
  target_usd: number; amount_sol: number; slippage_bps: number; status: string; created_at: string; sig: string | null;
};
export async function createLimitOrder(o: {
  mint: string; symbol: string; trigger: "below" | "above"; target_usd: number;
  amount_sol: number; slippage_bps: number; user_pubkey: string; wallet_id?: string;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { error: { message: "sign in first" } };
  return supabase.from("limit_orders").insert({ user_id: uid, ...o });
}
export async function getMyLimitOrders(): Promise<DbLimitOrder[]> {
  const { data, error } = await supabase
    .from("limit_orders")
    .select("id,mint,symbol,trigger,target_usd,amount_sol,slippage_bps,status,created_at,sig")
    .order("created_at", { ascending: false });
  if (error) return [];
  return data ?? [];
}
export async function cancelLimitOrder(id: string) {
  return supabase.from("limit_orders").update({ status: "cancelled" }).eq("id", id);
}
export async function markOrderFilled(id: string, sig?: string) {
  return supabase.from("limit_orders").update({ status: "filled", sig, filled_at: new Date().toISOString() }).eq("id", id);
}

// ---- copy-trade subscriptions ----
export type CopySub = {
  id: string; leader_wallet: string; label: string | null; size_sol: number;
  slippage_bps: number; daily_cap_sol: number; enabled: boolean;
  tp1: number | null; tp1_sell: number | null; tp2: number | null; tp2_sell: number | null; stop_loss: number | null;
};
export async function getMyCopySubs(): Promise<CopySub[]> {
  const { data, error } = await supabase
    .from("copy_subscriptions")
    .select("id,leader_wallet,label,size_sol,slippage_bps,daily_cap_sol,enabled,tp1,tp1_sell,tp2,tp2_sell,stop_loss");
  if (error) return [];
  return data ?? [];
}
export async function saveCopySub(sub: {
  leader_wallet: string; label?: string; size_sol: number; slippage_bps?: number;
  daily_cap_sol?: number; user_pubkey: string; wallet_id?: string;
  tp1?: number; tp1_sell?: number; tp2?: number; tp2_sell?: number; stop_loss?: number;
}) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return { error: { message: "sign in first" } };
  return supabase.from("copy_subscriptions").upsert(
    { user_id: uid, enabled: true, ...sub },
    { onConflict: "user_id,leader_wallet" }
  );
}
export async function removeCopySub(leader_wallet: string) {
  return supabase.from("copy_subscriptions").delete().eq("leader_wallet", leader_wallet);
}

// ---- live token data (DexScreener via our API) ----
export type LiveToken = {
  address: string; symbol: string; name: string; image: string | null;
  priceUsd: number | null; marketCap: number | null; liquidityUsd: number | null;
  volume24h: number | null; change24h: number | null; change1h: number | null;
  ageMs: number | null; dex: string | null; url: string;
};
export async function fetchTokens(mode: "trending" | "new"): Promise<any[]> {
  return fetch(`/api/tokens?mode=${mode}`).then((r) => r.json()).then((d) => d.tokens ?? []).catch(() => []);
}
export async function fetchTokensFull(mode: "trending" | "new"): Promise<{ tokens: any[]; stats: any }> {
  return fetch(`/api/tokens?mode=${mode}`).then((r) => r.json()).then((d) => ({ tokens: d.tokens ?? [], stats: d.stats ?? { count: 0, totalVol: 0 } })).catch(() => ({ tokens: [], stats: { count: 0, totalVol: 0 } }));
}
export function fmtNum(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}
export function fmtAge(ms: number | null): string {
  if (ms == null) return "—";
  const m = ms / 60000;
  if (m < 60) return Math.round(m) + "m";
  const h = m / 60;
  if (h < 24) return Math.round(h) + "h";
  return Math.round(h / 24) + "d";
}
