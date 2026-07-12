"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { fmtUsd, createLimitOrder, getMyLimitOrders, cancelLimitOrder, markOrderFilled, type DbLimitOrder } from "@/lib/queries";
import { useExecuteBuy } from "@/lib/useExecuteBuy";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId } from "@/lib/solanaWallet";

const POLL_MS = 20000;

// Privy + trade-execution body for limit orders. Lazily loaded by app/orders/page.tsx.
export default function OrdersBody() {
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const executeBuy = useExecuteBuy();
  const toast = useToast();
  const [orders, setOrders] = useState<DbLimitOrder[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [auto, setAuto] = useState(false);
  const [mint, setMint] = useState("");
  const [symbol, setSymbol] = useState("");
  const [trigger, setTrigger] = useState<"below" | "above">("below");
  const [target, setTarget] = useState(0);
  const [amount, setAmount] = useState(0.5);
  const [slippage, setSlippage] = useState(3);
  const firing = useRef<Set<string>>(new Set());

  const pubkey = getSolanaAddress(user);
  const walletId = getSolanaWalletId(user);

  const refresh = useCallback(async () => {
    if (authenticated) setOrders(await getMyLimitOrders(await getAccessToken()));
  }, [authenticated, getAccessToken]);
  useEffect(() => { refresh(); }, [refresh]);

  const runExec = useCallback(async (o: DbLimitOrder) => {
    if (firing.current.has(o.id)) return;
    firing.current.add(o.id);
    const r = await executeBuy({ mint: o.mint, solAmount: o.amount_sol, slippageBps: o.slippage_bps, symbol: o.symbol ?? undefined });
    firing.current.delete(o.id);
    if (r.ok) { await markOrderFilled(o.id, r.sig, await getAccessToken()); toast(`Limit filled — ${o.symbol}`); refresh(); }
    else toast(r.error || "Execution failed", "err");
  }, [toast, refresh, executeBuy, getAccessToken]);

  // client watcher: prices + optional execute while the tab is open (worker handles offline)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const open = orders.filter((o) => o.status === "open");
      for (const m of Array.from(new Set(open.map((o) => o.mint)))) {
        const p = await fetch(`/api/price?mint=${m}`).then((r) => r.json()).catch(() => null);
        if (!alive) return;
        const price = p?.priceUsd ? Number(p.priceUsd) : 0;
        if (price) setPrices((prev) => ({ ...prev, [m]: price }));
        for (const o of open.filter((x) => x.mint === m)) {
          const hit = o.trigger === "below" ? price && price <= o.target_usd : price && price >= o.target_usd;
          if (hit && auto) runExec(o);
        }
      }
    };
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [orders, auto, runExec]);

  const create = async () => {
    if (!authenticated || !pubkey) { login(); return; }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) || target <= 0 || amount <= 0) { toast("Enter a valid mint, target and amount", "err"); return; }
    const { error } = await createLimitOrder({ mint, symbol: symbol || mint.slice(0, 6), trigger, target_usd: target, amount_sol: amount, slippage_bps: slippage * 100, user_pubkey: pubkey, wallet_id: walletId }, await getAccessToken());
    if (error) { toast(error.message || "Could not save order", "err"); return; }
    toast("Limit order created"); setMint(""); setSymbol(""); setTarget(0); refresh();
  };

  const open = orders.filter((o) => o.status === "open");
  const done = orders.filter((o) => o.status !== "open");

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
            <span className="rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic">LIVE</span>
          </h1>
          <p className="mt-1 text-sm text-dim">Auto-buy when a token hits your price. Saved to your account — the 24/7 engine runs them even when you are offline.</p>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs text-dim">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-toxic" />
          Also execute in this tab
        </label>
      </div>

      <div className="mt-5 grid gap-2 rounded-lg border border-edge bg-panel p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input value={mint} onChange={(e) => setMint(e.target.value)} placeholder="Token mint" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic lg:col-span-2" />
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as any)} className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs">
          <option value="below">price ≤</option><option value="above">price ≥</option>
        </select>
        <input type="number" step="any" value={target || ""} onChange={(e) => setTarget(+e.target.value)} placeholder="$ target" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <input type="number" step="0.1" value={amount} onChange={(e) => setAmount(+e.target.value)} placeholder="SOL" className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <button onClick={create} className="col-span-full rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic">+ Create limit order</button>
      </div>

      <div className="mt-6 space-y-2">
        {!open.length && <p className="text-sm text-dim">No open orders. Create one above, or from the token drawer.</p>}
        {open.map((o) => {
          const price = prices[o.mint];
          const ready = price != null && (o.trigger === "below" ? price <= o.target_usd : price >= o.target_usd);
          return (
            <div key={o.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${ready ? "border-toxic/60 bg-toxic/5" : "border-edge bg-panel"}`}>
              <div>
                <p className="font-bold">{o.symbol} <span className="font-mono text-xs text-dim">buy {o.amount_sol} SOL when {o.trigger === "below" ? "≤" : "≥"} ${o.target_usd}</span></p>
                <p className="font-mono text-[11px] text-dim">now {price != null ? fmtUsd(price) : "…"} · {o.mint.slice(0, 10)}…</p>
              </div>
              <div className="flex items-center gap-2">
                {ready && <span className="rounded-full bg-toxic/20 px-2 py-0.5 font-mono text-[10px] font-bold text-toxic">READY</span>}
                <button onClick={() => runExec(o)} className="rounded-md bg-toxic px-3 py-1.5 text-xs font-bold text-white shadow-toxic transition hover:brightness-110">Execute</button>
                <button onClick={async () => { try { await cancelLimitOrder(o.id, await getAccessToken()); refresh(); } catch {} }} className="font-mono text-[11px] text-hotpink hover:underline">cancel</button>
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
              <div key={o.id} className="flex items-center justify-between rounded-md border border-edge px-4 py-2 font-mono text-[11px]">
                <span>{o.symbol} · {o.amount_sol} SOL</span>
                <span className={o.status === "filled" ? "text-toxic" : "text-dim"}>{o.status}{o.sig ? ` · ${o.sig.slice(0, 8)}…` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
