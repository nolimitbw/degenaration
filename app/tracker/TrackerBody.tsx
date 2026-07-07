"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getNet } from "@/lib/net";
import { fetchPortfolio, fmtUsd, getMyCopySubs, saveCopySub, removeCopySub, type Portfolio, type CopySub } from "@/lib/queries";
import { useToast } from "@/components/Toast";

type Tracked = { address: string; label: string };

// Privy-dependent wallet-tracker body. Lazily loaded by app/tracker/page.tsx.
export default function TrackerBody() {
  const { user, authenticated, login } = usePrivy();
  const toast = useToast();
  const [wallets, setWallets] = useState<Tracked[]>([]);
  const [pfs, setPfs] = useState<Record<string, Portfolio>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [subs, setSubs] = useState<CopySub[]>([]);
  const [copyFor, setCopyFor] = useState<string | null>(null);
  const [copySize, setCopySize] = useState(0.1);
  const [copyCap, setCopyCap] = useState(2);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => { if (authenticated) getMyCopySubs().then(setSubs); }, [authenticated]);
  const isCopied = (a: string) => subs.some((s) => s.leader_wallet === a && s.enabled);

  async function enableCopy(leader: string, lbl: string) {
    if (!authenticated) { login(); return; }
    const pubkey = (user as any)?.wallet?.address as string | undefined;
    const walletId = (user as any)?.wallet?.id as string | undefined;
    if (!pubkey) { toast("No wallet found", "err"); return; }
    const { error } = await saveCopySub({ leader_wallet: leader, label: lbl, size_sol: copySize, daily_cap_sol: copyCap, slippage_bps: 300, user_pubkey: pubkey, wallet_id: walletId });
    if (error) { toast(error.message || "Could not enable copy", "err"); return; }
    toast(`Copying ${lbl} — ${copySize} SOL/trade, cap ${copyCap}`); setCopyFor(null); getMyCopySubs().then(setSubs);
  }
  async function disableCopy(leader: string) {
    await removeCopySub(leader); toast("Copy trade stopped"); getMyCopySubs().then(setSubs);
  }

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("degen_tracked") : null;
    setWallets(saved ? JSON.parse(saved) : []);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("degen_tracked", JSON.stringify(wallets));
    let alive = true;
    const load = () => wallets.forEach(async (w) => {
      setLoading((l) => ({ ...l, [w.address]: !pfs[w.address] }));
      const p = await fetchPortfolio(w.address, getNet());
      if (alive && p && !(p as any).error) setPfs((prev) => ({ ...prev, [w.address]: p }));
      setLoading((l) => ({ ...l, [w.address]: false }));
    });
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line
  }, [wallets]);

  const add = () => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return;
    setWallets((w) => [...w.filter((x) => x.address !== addr), { address: addr, label: label || addr.slice(0, 6) }]);
    setAddr(""); setLabel("");
  };
  const remove = (a: string) => setWallets((w) => w.filter((x) => x.address !== a));

  return (
    <>
      <h1 className="flex items-center gap-2 text-2xl font-bold">Wallet Tracker
        <span className="rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic">LIVE</span>
      </h1>
      <p className="mt-1 text-sm text-dim">Follow any wallet and see exactly what it holds on-chain, priced live. Refreshes every 30s.</p>

      <div className="mt-5 flex flex-wrap gap-2">
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Wallet address to track"
          className="flex-1 min-w-[240px] rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)"
          className="w-40 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
        <button onClick={add} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic">+ Track</button>
      </div>

      {!wallets.length && (
        <div className="mt-6 grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
          <p className="text-sm font-bold text-dim">No wallets tracked yet</p>
          <p className="mt-1 font-mono text-[11px] text-dim/70">Paste any Solana wallet to see its live token holdings and portfolio value.</p>
        </div>
      )}

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {wallets.map((w) => {
          const pf = pfs[w.address];
          const busy = loading[w.address];
          const top = pf?.positions?.slice(0, 6) ?? [];
          return (
            <div key={w.address} className="gradient-border rounded-lg border border-edge p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold">{w.label}</p>
                  <a href={`https://solscan.io/account/${w.address}`} target="_blank" rel="noreferrer" className="truncate font-mono text-[11px] text-dim hover:text-cyber">{w.address.slice(0, 8)}…{w.address.slice(-6)}</a>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-bold text-toxic">{pf ? fmtUsd(pf.totalUsd) : busy ? "…" : "—"}</p>
                  <p className="font-mono text-[10px] text-dim">{pf ? `${pf.sol.toFixed(2)} SOL · ${pf.count} tokens` : ""}</p>
                </div>
              </div>

              {top.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  {top.map((p) => (
                    <div key={p.mint} className="flex items-center gap-2 font-mono text-xs">
                      {p.image ? <img src={p.image} alt="" className="h-5 w-5 rounded-full" /> : <div className="grid h-5 w-5 place-items-center rounded-full bg-edge text-[8px]">{(p.symbol ?? "?").slice(0, 2)}</div>}
                      <span className="w-16 truncate font-bold">{p.symbol ?? p.mint.slice(0, 4)}</span>
                      <span className={`w-14 ${(p.change24h ?? 0) >= 0 ? "text-toxic" : "text-hotpink"}`}>{p.change24h != null ? `${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(0)}%` : ""}</span>
                      <span className="flex-1 text-right text-dim">{fmtUsd(p.valueUsd)}</span>
                      <Link href={`/terminal?mint=${p.mint}`} className="text-cyber hover:text-gray-900" title="trade" aria-label={`Trade ${p.symbol ?? p.mint.slice(0, 4)}`}>↗</Link>
                    </div>
                  ))}
                </div>
              ) : pf ? (
                <p className="mt-3 font-mono text-[11px] text-dim">No priced token holdings.</p>
              ) : (
                <div className="mt-3 space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-5 animate-pulse rounded bg-edge/40" />)}</div>
              )}

              {copyFor === w.address ? (
                <div className="mt-3 rounded-md border border-toxic/40 bg-void p-2">
                  <div className="flex items-center gap-2 font-mono text-[10px] text-dim">
                    <label className="flex-1">size SOL<input type="number" step="0.1" value={copySize} onChange={(e) => setCopySize(+e.target.value)} className="mt-0.5 w-full rounded border border-edge bg-panel px-2 py-1 text-gray-900 outline-none focus:border-toxic" /></label>
                    <label className="flex-1">daily cap<input type="number" step="0.5" value={copyCap} onChange={(e) => setCopyCap(+e.target.value)} className="mt-0.5 w-full rounded border border-edge bg-panel px-2 py-1 text-gray-900 outline-none focus:border-toxic" /></label>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => enableCopy(w.address, w.label)} className="flex-1 rounded bg-toxic py-1.5 font-mono text-[11px] font-bold text-white">Start copying</button>
                    <button onClick={() => setCopyFor(null)} className="rounded border border-edge px-3 py-1.5 font-mono text-[11px] text-dim">cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex items-center gap-3">
                  {isCopied(w.address) ? (
                    <button onClick={() => disableCopy(w.address)} className="rounded-md border border-toxic/50 px-3 py-1 font-mono text-[11px] font-bold text-toxic hover:bg-toxic/10">● Copying · stop</button>
                  ) : (
                    <button onClick={() => setCopyFor(w.address)} className="rounded-md bg-cyber/20 px-3 py-1 font-mono text-[11px] font-bold text-cyber hover:bg-cyber/30">Copy trades</button>
                  )}
                  <button onClick={() => remove(w.address)} className="font-mono text-[11px] text-hotpink hover:underline">remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
