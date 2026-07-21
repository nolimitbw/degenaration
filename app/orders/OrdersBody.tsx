"use client";
import { useCallback, useEffect, useState } from "react";
import { getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { fmtUsd, createLimitOrder, getMyLimitOrders, cancelLimitOrder, type DbLimitOrder } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";
import { automationLabel, useAutomationStatus } from "@/lib/useAutomationStatus";

const POLL_MS = 20000;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function triggerHit(order: DbLimitOrder, price?: number) {
  if (!price) return false;
  return order.trigger === "below" ? price <= order.target_usd : price >= order.target_usd;
}

function orderDraftError(mint: string, target: number, amount: number, slippage: number, walletId?: string | null, delegated?: boolean, automationLive?: boolean) {
  if (!MINT_RE.test(mint.trim())) return "Paste a valid Solana token mint.";
  if (!Number.isFinite(target) || target <= 0) return "Enter a target price above zero.";
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100) return "Order size must be between 0 and 100 SOL.";
  if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 20) return "Slippage must be between 0.01% and 20%.";
  if (!walletId || !delegated) return "Enable 24/7 auto-trading before creating limit orders.";
  if (!automationLive) return "The 24/7 execution engine is not live.";
  return null;
}

// Privy + trade-execution body for limit orders. Lazily loaded by app/orders/page.tsx.
export default function OrdersBody() {
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const toast = useToast();
  const [orders, setOrders] = useState<DbLimitOrder[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [mint, setMint] = useState("");
  const [symbol, setSymbol] = useState("");
  const [trigger, setTrigger] = useState<"below" | "above">("below");
  const [target, setTarget] = useState(0);
  const [amount, setAmount] = useState(0.5);
  const [slippage, setSlippage] = useState(3);

  const pubkey = getSolanaAddress(user);
  const walletId = getSolanaWalletId(user);
  const delegated = hasDelegatedSolanaWallet(user);
  const automation = useAutomationStatus();

  const refresh = useCallback(async () => {
    if (authenticated) setOrders(await getMyLimitOrders(await getAccessToken()));
  }, [authenticated, getAccessToken]);
  useEffect(() => { refresh(); }, [refresh]);

  // The browser only displays trigger state. The worker owns execution and its atomic claim.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const open = orders.filter((o) => o.status === "open");
      for (const m of Array.from(new Set(open.map((o) => o.mint)))) {
        const p = await fetch(`/api/price?mint=${m}`).then((r) => r.json()).catch(() => null);
        if (!alive) return;
        const price = p?.priceUsd ? Number(p.priceUsd) : 0;
        if (price) setPrices((prev) => ({ ...prev, [m]: price }));
      }
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [orders]);

  const create = async () => {
    if (!authenticated || !pubkey) { login(); return; }
    const draftError = orderDraftError(mint, target, amount, slippage, walletId, delegated, automation.live);
    if (draftError) { toast(draftError, "err"); return; }
    const cleanMint = mint.trim();
    const { error } = await createLimitOrder({ mint: cleanMint, symbol: symbol || cleanMint.slice(0, 6), trigger, target_usd: target, amount_sol: amount, slippage_bps: Math.round(slippage * 100), user_pubkey: pubkey, wallet_id: walletId }, await getAccessToken(), await getIdentityToken());
    if (error) { toast(error.message || "Could not save order", "err"); return; }
    toast("Limit order created"); setMint(""); setSymbol(""); setTarget(0); refresh();
  };

  const active = orders.filter((o) => o.status === "open" || o.status === "processing");
  const done = orders.filter((o) => o.status !== "open" && o.status !== "processing");
  const draftError = orderDraftError(mint, target, amount, slippage, walletId, delegated, automation.live);

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-edge bg-panel p-8 text-center">
        <h1 className="text-xl font-bold">Limit Orders</h1>
        <p className="mt-2 text-sm text-dim">Connect your wallet to create auto-buy orders that run 24/7.</p>
        <button onClick={login} className="mt-6 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic">Connect wallet</button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">Limit Orders
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${automation.live ? "border-toxic/40 text-toxic" : "border-edge text-dim"}`}>{automationLabel(automation)}</span>
          </h1>
          <p className="mt-1 text-sm text-dim">Auto-buy when a token hits your price. Saved to your account — the 24/7 engine runs them even when you are offline.</p>
        </div>
        <span className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs text-dim">Database-claimed execution</span>
      </div>
      {pubkey && (!walletId || !delegated) && (
        <div className="mt-5 rounded-lg border border-hotpink/40 bg-hotpink/5 px-4 py-3">
          <p className="text-sm font-bold text-ink">Enable 24/7 auto-trading before creating offline limit orders.</p>
          <p className="mt-1 font-mono text-[11px] text-dim">The worker needs your delegated Privy Solana wallet id to execute limits when this tab is closed.</p>
          <a href="/wallet" className="mt-3 inline-flex rounded-md bg-toxic px-4 py-2 text-xs font-bold text-white shadow-toxic">Open Wallet</a>
        </div>
      )}

      <div className="mt-5 grid gap-2 rounded-lg border border-edge bg-panel p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Token mint" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic lg:col-span-2" />
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as any)} className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs">
          <option value="below">price ≤</option><option value="above">price ≥</option>
        </select>
        <input type="number" step="any" value={target || ""} onChange={(e) => setTarget(+e.target.value)} placeholder="$ target" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <input type="number" step="0.1" value={amount} onChange={(e) => setAmount(+e.target.value)} placeholder="SOL" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <input type="number" step="0.1" value={slippage} onChange={(e) => setSlippage(+e.target.value)} placeholder="Slippage %" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-cyber" />
        {draftError && <p className="col-span-full font-mono text-[11px] text-dim">{draftError}</p>}
        <button onClick={create} disabled={!!draftError} className="col-span-full rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic disabled:cursor-not-allowed disabled:opacity-50">+ Create limit order</button>
      </div>

      <div className="mt-6 space-y-2">
        {!active.length && <p className="text-sm text-dim">No open orders. Create one above, or from the token drawer.</p>}
        {active.map((o) => {
          const price = prices[o.mint];
          const processing = o.status === "processing";
          const ready = !processing && triggerHit(o, price);
          return (
            <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${ready ? "border-toxic/60 bg-toxic/5" : "border-edge bg-panel"}`}>
              <div>
                <p className="font-bold">{o.symbol} <span className="font-mono text-xs text-dim">buy {o.amount_sol} SOL when {o.trigger === "below" ? "≤" : "≥"} ${o.target_usd}</span></p>
                <p className="font-mono text-[11px] text-dim">now {price != null ? fmtUsd(price) : "…"} · {o.mint.slice(0, 10)}…</p>
              </div>
              <div className="flex items-center gap-2">
                {ready && <span className="rounded-full bg-toxic/20 px-2 py-0.5 font-mono text-[10px] font-bold text-toxic">READY</span>}
                <span className={`rounded-md border px-3 py-1.5 font-mono text-xs ${ready || processing ? "border-toxic/50 text-toxic" : "border-edge text-dim"}`}>{processing ? "Processing" : ready ? "Queued" : "Waiting"}</span>
                {!processing && <button onClick={async () => { try { await cancelLimitOrder(o.id, await getAccessToken()); refresh(); } catch {} }} className="font-mono text-[11px] text-hotpink hover:underline">cancel</button>}
              </div>
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <div className="mt-8">
          <h2 className="font-mono text-xs uppercase text-dim">History</h2>
          <div className="mt-2 space-y-1">
            {done.map((o) => (
              <div key={o.id} className="flex items-start justify-between gap-4 rounded-md border border-edge px-4 py-2 font-mono text-[11px]">
                <span>{o.symbol} · {o.amount_sol} SOL{o.last_error ? <span className="mt-1 block max-w-xl text-hotpink">{o.last_error}</span> : null}</span>
                <span className={o.status === "filled" ? "text-toxic" : "text-dim"}>{o.status}{o.sig ? ` · ${o.sig.slice(0, 8)}…` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
