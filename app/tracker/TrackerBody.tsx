"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getNet } from "@/lib/net";
import { fetchPortfolio, fetchBalance, fmtUsd, getMyCopySubs, saveCopySub, removeCopySub, type Portfolio, type CopySub } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId } from "@/lib/solanaWallet";

type Tracked = { address: string; label: string };
type SmartWallet = { address: string; catches: { symbol: string; mint: string; multiple: number }[]; catchCount: number; bestMultiple: number; avgMultiple: number };
type CopySettings = { size: number; tp1: number; tp1sell: number; tp2: number; tp2sell: number; sl: number; dailyCap: number };
const DEFAULT_SETTINGS: CopySettings = { size: 0.1, tp1: 2, tp1sell: 50, tp2: 5, tp2sell: 25, sl: 40, dailyCap: 2 };

function short(a: string) { return `${a.slice(0, 4)}…${a.slice(-4)}`; }

// Shared copy-trade settings form — used for both discovered "smart money" wallets and
// manually-tracked ones. Size / take-profit ladder / stop-loss / daily cap, all editable.
function CopyPanel({ settings, onChange, onStart, onCancel }: { settings: CopySettings; onChange: (s: CopySettings) => void; onStart: () => void; onCancel: () => void }) {
  const field = (label: string, key: keyof CopySettings, step = "0.1", suffix = "") => (
    <label className="block">
      <span className="font-mono text-[10px] uppercase text-dim">{label}</span>
      <div className="mt-0.5 flex items-center gap-1">
        <input type="number" step={step} value={settings[key]} onChange={(e) => onChange({ ...settings, [key]: +e.target.value })}
          className="w-full rounded border border-edge bg-panel px-2 py-1 text-xs text-ink outline-none focus:border-toxic" />
        {suffix && <span className="font-mono text-[10px] text-dim">{suffix}</span>}
      </div>
    </label>
  );
  return (
    <div className="mt-3 rounded-md border border-toxic/40 bg-void p-3">
      <div className="grid grid-cols-2 gap-2">
        {field("Size / trade", "size", "0.05", "SOL")}
        {field("Daily cap", "dailyCap", "0.5", "SOL")}
        {field("Take-profit 1", "tp1", "0.5", "x")}
        {field("Sell at TP1", "tp1sell", "5", "%")}
        {field("Take-profit 2", "tp2", "0.5", "x")}
        {field("Sell at TP2", "tp2sell", "5", "%")}
        {field("Stop-loss", "sl", "5", "%")}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onStart} className="flex-1 rounded bg-toxic py-1.5 font-mono text-[11px] font-bold text-white">Start copying</button>
        <button onClick={onCancel} className="rounded border border-edge px-3 py-1.5 font-mono text-[11px] text-dim">cancel</button>
      </div>
    </div>
  );
}

// Privy-dependent wallet-tracker body. Lazily loaded by app/tracker/page.tsx.
export default function TrackerBody() {
  const { user, authenticated, login } = usePrivy();
  const toast = useToast();
  const address = getSolanaAddress(user);
  const walletId = getSolanaWalletId(user);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceChecked, setBalanceChecked] = useState(false);
  const [smart, setSmart] = useState<SmartWallet[]>([]);
  const [smartLoading, setSmartLoading] = useState(true);
  const [wallets, setWallets] = useState<Tracked[]>([]);
  const [pfs, setPfs] = useState<Record<string, Portfolio>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [subs, setSubs] = useState<CopySub[]>([]);
  const [copyFor, setCopyFor] = useState<string | null>(null);
  const [settings, setSettings] = useState<CopySettings>(DEFAULT_SETTINGS);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => { if (authenticated) getMyCopySubs().then(setSubs); }, [authenticated]);
  useEffect(() => {
    if (!authenticated || !address) { setBalanceChecked(true); return; }
    setBalanceChecked(false);
    fetchBalance(address, getNet()).then((b) => { setBalance(b?.sol ?? 0); setBalanceChecked(true); });
  }, [authenticated, address]);

  useEffect(() => {
    fetch("/api/smart-wallets").then((r) => r.json()).then((d) => { setSmart(d?.wallets ?? []); setSmartLoading(false); }).catch(() => setSmartLoading(false));
  }, []);

  const isCopied = (a: string) => subs.some((s) => s.leader_wallet === a && s.enabled);
  const hasFunds = authenticated && address && (balance ?? 0) > 0;

  function openCopy(leader: string) {
    if (!authenticated) { login(); return; }
    if (!hasFunds) { toast("Fund your wallet with SOL first — see /wallet", "err"); return; }
    setSettings(DEFAULT_SETTINGS);
    setCopyFor(leader);
  }
  async function enableCopy(leader: string, lbl: string) {
    if (!address) { toast("No wallet found", "err"); return; }
    const { error } = await saveCopySub({
      leader_wallet: leader, label: lbl, size_sol: settings.size, daily_cap_sol: settings.dailyCap,
      tp1: settings.tp1, tp1_sell: settings.tp1sell, tp2: settings.tp2, tp2_sell: settings.tp2sell, stop_loss: settings.sl,
      slippage_bps: 300, user_pubkey: address, wallet_id: walletId
    });
    if (error) { toast(error.message || "Could not enable copy", "err"); return; }
    toast(`Copying ${lbl} — ${settings.size} SOL/trade`); setCopyFor(null); getMyCopySubs().then(setSubs);
  }
  async function disableCopy(leader: string) {
    try {
      const { error } = await removeCopySub(leader);
      if (error) { toast(error.message || "Could not stop copy", "err"); return; }
      toast("Copy trade stopped"); getMyCopySubs().then(setSubs);
    } catch { toast("Could not stop copy", "err"); }
  }

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("degen_tracked") : null;
    setWallets(saved ? JSON.parse(saved) : []);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("degen_tracked", JSON.stringify(wallets));
    let alive = true;
    const load = () => wallets.forEach(async (w) => {
      setLoading((l) => ({ ...l, [w.address]: true }));
      const p = await fetchPortfolio(w.address, getNet());
      if (alive && p && !(p as any).error) setPfs((prev) => ({ ...prev, [w.address]: p }));
      setLoading((l) => ({ ...l, [w.address]: false }));
    });
    load();
    const iv = setInterval(load, 30000);
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line
  }, [wallets]);

  const add = (a: string, lbl?: string) => {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return;
    if (!authenticated) { login(); return; }
    if (!hasFunds) { toast("Fund your wallet with SOL first — see /wallet", "err"); return; }
    setWallets((w) => [...w.filter((x) => x.address !== a), { address: a, label: lbl || a.slice(0, 6) }]);
    setAddr(""); setLabel("");
  };
  const remove = (a: string) => setWallets((w) => w.filter((x) => x.address !== a));

  return (
    <>
      <h1 className="flex items-center gap-2 text-2xl font-bold">Wallet Tracker
        <span className="rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic">LIVE</span>
      </h1>
      <p className="mt-1 text-sm text-dim">Real on-chain smart-money discovery, plus any wallet you want to follow — priced live.</p>

      {/* gate: must be connected + funded before tracking/copying anything */}
      {!authenticated ? (
        <div className="mt-6 grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
          <p className="text-sm font-bold text-dim">Connect your wallet to track or copy-trade</p>
          <p className="mt-1 max-w-md font-mono text-[11px] text-dim/70">Sign in to see the smart-money leaderboard, follow any wallet, and set up copy trading.</p>
          <button onClick={login} className="mt-4 rounded-md bg-toxic px-6 py-2.5 text-sm font-bold text-white shadow-toxic">Connect wallet</button>
        </div>
      ) : !balanceChecked ? (
        <div className="mt-6 grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
          <p className="font-mono text-xs text-dim">Checking your balance…</p>
        </div>
      ) : !hasFunds ? (
        <div className="mt-6 grid place-items-center rounded-lg border border-hotpink/40 bg-panel/40 py-12 text-center">
          <p className="text-sm font-bold text-dim">Add SOL to your wallet to unlock tracking &amp; copy trading</p>
          <p className="mt-1 max-w-md font-mono text-[11px] text-dim/70">Your balance is {balance?.toFixed(3) ?? "0"} SOL. Deposit first — copy trades need real funds to execute.</p>
          <Link href="/wallet" className="mt-4 rounded-md bg-toxic px-6 py-2.5 text-sm font-bold text-white shadow-toxic">Go to Wallet</Link>
        </div>
      ) : (
        <>
          {/* smart money discovery */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold">Smart Money
                <span className="rounded-full border border-cyber/40 px-2 py-0.5 font-mono text-[10px] text-cyber">real on-chain</span>
              </h2>
            </div>
            <p className="mt-1 font-mono text-[11px] text-dim">
              Wallets that bought today's biggest gainers early, ranked by repeat hits and unrealized performance — computed live from real trades, not a fixed list.
            </p>
            {smartLoading ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg border border-edge bg-panel/40" />)}</div>
            ) : smart.length === 0 ? (
              <p className="mt-3 font-mono text-[11px] text-dim/70">No qualifying early-buyer wallets in this scan window — check back shortly.</p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {smart.map((s) => (
                  <div key={s.address} className="gradient-border rounded-lg border border-edge p-3">
                    <div className="flex items-start justify-between gap-2">
                      <a href={`https://solscan.io/account/${s.address}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-dim hover:text-cyber">{short(s.address)}</a>
                      <span className="rounded-full bg-toxic/15 px-2 py-0.5 font-mono text-[10px] font-bold text-toxic">{s.bestMultiple.toFixed(1)}x best</span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-dim">{s.catchCount} early {s.catchCount === 1 ? "catch" : "catches"} · {s.catches.map((c) => c.symbol).join(", ")}</p>
                    {copyFor === s.address ? (
                      <CopyPanel settings={settings} onChange={setSettings} onStart={() => enableCopy(s.address, s.catches[0]?.symbol ?? short(s.address))} onCancel={() => setCopyFor(null)} />
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        {isCopied(s.address) ? (
                          <button onClick={() => disableCopy(s.address)} className="rounded-md border border-toxic/50 px-3 py-1 font-mono text-[11px] font-bold text-toxic hover:bg-toxic/10">● Copying · stop</button>
                        ) : (
                          <button onClick={() => openCopy(s.address)} className="rounded-md bg-cyber/20 px-3 py-1 font-mono text-[11px] font-bold text-cyber hover:bg-cyber/30">Copy trades</button>
                        )}
                        <button onClick={() => add(s.address, s.catches[0]?.symbol)} className="font-mono text-[11px] text-dim hover:text-ink">+ track</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* manual tracking */}
          <div className="mt-8">
            <h2 className="text-lg font-bold">Your tracked wallets</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Wallet address to track"
                className="flex-1 min-w-[240px] rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)"
                className="w-40 rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs outline-none focus:border-toxic" />
              <button onClick={() => add(addr, label)} className="rounded-md bg-toxic px-4 py-2 text-sm font-bold text-white shadow-toxic">+ Track</button>
            </div>

            {!wallets.length && (
              <div className="mt-4 grid place-items-center rounded-lg border border-edge bg-panel/40 py-10 text-center">
                <p className="text-sm font-bold text-dim">No wallets tracked yet</p>
                <p className="mt-1 font-mono text-[11px] text-dim/70">Paste any Solana wallet, or track one from Smart Money above.</p>
              </div>
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
                            <span className={`w-14 ${(p.change24h ?? 0) >= 0 ? "text-up" : "text-hotpink"}`}>{p.change24h != null ? `${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(0)}%` : ""}</span>
                            <span className="flex-1 text-right text-dim">{fmtUsd(p.valueUsd)}</span>
                            <Link href={`/terminal?mint=${p.mint}`} className="text-cyber hover:text-ink" title="trade" aria-label={`Trade ${p.symbol ?? p.mint.slice(0, 4)}`}>↗</Link>
                          </div>
                        ))}
                      </div>
                    ) : pf ? (
                      <p className="mt-3 font-mono text-[11px] text-dim">No priced token holdings.</p>
                    ) : (
                      <div className="mt-3 space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-5 animate-pulse rounded bg-edge/40" />)}</div>
                    )}

                    {copyFor === w.address ? (
                      <CopyPanel settings={settings} onChange={setSettings} onStart={() => enableCopy(w.address, w.label)} onCancel={() => setCopyFor(null)} />
                    ) : (
                      <div className="mt-3 flex items-center gap-3">
                        {isCopied(w.address) ? (
                          <button onClick={() => disableCopy(w.address)} className="rounded-md border border-toxic/50 px-3 py-1 font-mono text-[11px] font-bold text-toxic hover:bg-toxic/10">● Copying · stop</button>
                        ) : (
                          <button onClick={() => openCopy(w.address)} className="rounded-md bg-cyber/20 px-3 py-1 font-mono text-[11px] font-bold text-cyber hover:bg-cyber/30">Copy trades</button>
                        )}
                        <button onClick={() => remove(w.address)} className="font-mono text-[11px] text-hotpink hover:underline">remove</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
