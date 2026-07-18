"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { Check, ExternalLink, Minus, Plus, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { getCallSources, getMySubscriptions, saveSubscription, type CallSource } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";
import { useAutomationStatus } from "@/lib/useAutomationStatus";

type Settings = { size: number; tp1: number; tp1sell: number; tp2: number; tp2sell: number; sl: number; slippage: number; dailyCap: number };
const DEFAULTS: Settings = { size: 0.5, tp1: 2, tp1sell: 50, tp2: 5, tp2sell: 25, sl: 40, slippage: 3, dailyCap: 2 };

function settingsError(cfg: Settings) {
  if (!Number.isFinite(cfg.size) || cfg.size <= 0 || cfg.size > 100) return "Size must be between 0 and 100 SOL.";
  if (!Number.isFinite(cfg.dailyCap) || cfg.dailyCap < cfg.size || cfg.dailyCap > 1000) return "Daily cap must be at least the trade size and no more than 1000 SOL.";
  if (!Number.isFinite(cfg.tp1) || cfg.tp1 <= 1) return "TP1 must be above 1x.";
  if (!Number.isFinite(cfg.tp2) || cfg.tp2 < cfg.tp1) return "TP2 must be equal to or above TP1.";
  if (!Number.isFinite(cfg.tp1sell) || cfg.tp1sell < 1 || cfg.tp1sell > 100) return "TP1 sell must be 1% to 100%.";
  if (!Number.isFinite(cfg.tp2sell) || cfg.tp2sell < 0 || cfg.tp2sell > 100) return "TP2 sell must be 0% to 100%.";
  if (cfg.tp1sell + cfg.tp2sell > 100) return "TP sells cannot add above 100%.";
  if (!Number.isFinite(cfg.sl) || cfg.sl <= 0 || cfg.sl > 100) return "Stop-loss must be 1% to 100%.";
  if (!Number.isFinite(cfg.slippage) || cfg.slippage <= 0 || cfg.slippage > 20) return "Slippage must be between 0.01% and 20%.";
  return null;
}

// Privy-aware Discord Calls body. Passes the embedded wallet id so the 24/7 worker can
// sign delegated buys when a subscribed group posts a call.
export default function CallsBody() {
  const { user, authenticated, login, getAccessToken } = usePrivy();
  const [groups, setGroups] = useState<CallSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState(false);
  const [copying, setCopying] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, Settings>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const toast = useToast();

  const pubkey = getSolanaAddress(user);
  const walletId = getSolanaWalletId(user);
  const delegated = hasDelegatedSolanaWallet(user);
  const automation = useAutomationStatus();

  async function persist(id: string, on: boolean) {
    if (!authenticated) { login(); return; }
    if (!pubkey) { toast("No wallet found", "err"); return; }
    if (on && (!walletId || !delegated)) { toast("Enable 24/7 auto-trading in Wallet first", "err"); return; }
    if (on && !automation.live) { toast("The 24/7 execution engine is not live", "err"); return; }
    const c = s(id);
    const invalid = settingsError(c);
    if (on && invalid) {
      setCopying((current) => current.filter((x) => x !== id));
      toast(invalid, "err");
      return;
    }
    const payloadSettings = !on && invalid ? DEFAULTS : c;
    setSaving(id);
    const token = await getAccessToken();
    const { error } = await saveSubscription({
      group_id: id, size_sol: payloadSettings.size, tp1: payloadSettings.tp1, tp1_sell: payloadSettings.tp1sell,
      tp2: payloadSettings.tp2, tp2_sell: payloadSettings.tp2sell, stop_loss: payloadSettings.sl, slippage_bps: Math.round(payloadSettings.slippage * 100),
      daily_cap_sol: payloadSettings.dailyCap, enabled: on, user_pubkey: pubkey, wallet_id: walletId
    }, token, await getIdentityToken());
    setSaving(null);
    if (error) {
      setCopying((current) => on ? current.filter((x) => x !== id) : [...new Set([...current, id])]);
      toast(error.message || "Could not save — sign in first", "err");
      return;
    }
    setCopying((current) => on ? [...new Set([...current, id])] : current.filter((x) => x !== id));
    setSaved(id); toast(on ? "Copying this group — saved" : "Copying paused"); setTimeout(() => setSaved(null), 1500);
  }

  function toggle(id: string) {
    if (!authenticated) { login(); return; }
    if (!pubkey) { toast("No wallet found", "err"); return; }
    const on = !copying.includes(id);
    if (on && (!walletId || !delegated)) { toast("Enable 24/7 auto-trading in Wallet first", "err"); return; }
    if (on && !automation.live) { toast("The 24/7 execution engine is not live", "err"); return; }
    const invalid = settingsError(s(id));
    if (on && invalid) { toast(invalid, "err"); return; }
    setCopying(on ? [...copying, id] : copying.filter((x) => x !== id));
    persist(id, on);
  }

  async function loadSources() {
    setLoaded(false);
    const g = await getCallSources().catch(() => []);
    setGroups(g);
    setLive(g.length > 0);
    setLoaded(true);
    setLastSync(new Date());
  }

  useEffect(() => {
    loadSources();
    if (!authenticated) return;
    getAccessToken().then((token) => getMySubscriptions(token)).then((subs) => {
      const enabled = subs.filter((s) => s.enabled).map((s) => s.group_id);
      setCopying(enabled);
      const saved: Record<string, Settings> = {};
      for (const s of subs) {
        saved[s.group_id] = {
          size: s.size_sol, tp1: s.tp1, tp1sell: s.tp1_sell,
          tp2: s.tp2, tp2sell: s.tp2_sell, sl: s.stop_loss,
          slippage: s.slippage_bps / 100, dailyCap: s.daily_cap_sol
        };
      }
      if (Object.keys(saved).length) setSettings(saved);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, getAccessToken]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(null); };
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [open]);

  const s = (id: string) => settings[id] ?? DEFAULTS;
  const set = (id: string, patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, [id]: { ...s(id), ...patch } }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Bots</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase ${live ? "border-up/35 bg-up/5 text-up" : "border-edge text-dim"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-up" : "bg-dim"}`} /> {live ? "Connected" : "No sources"}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-dim">
            Follow approved Discord call sources and define independent execution rules for each server.
          </p>
        </div>
        <button onClick={loadSources} disabled={!loaded}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 py-2 text-xs font-bold text-ink transition hover:border-toxic disabled:opacity-50">
          <RefreshCw size={14} className={!loaded ? "animate-spin" : ""} /> {loaded ? "Refresh" : "Loading"}
        </button>
      </div>
      <div className="mt-6 grid gap-px border border-edge bg-edge sm:grid-cols-3">
        <HeaderMetric label="Approved sources" value={loaded ? String(groups.length) : "--"} />
        <HeaderMetric label="Copying" value={authenticated ? String(copying.length) : "Connect wallet"} />
        <HeaderMetric label="Last sync" value={lastSync ? lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--"} />
      </div>
      {authenticated && pubkey && (!walletId || !delegated) && (
        <div className="mt-4 rounded-lg border border-hotpink/40 bg-hotpink/5 px-4 py-3">
          <p className="text-sm font-bold text-ink">Enable 24/7 auto-trading before copying call groups.</p>
          <p className="mt-1 font-mono text-[11px] text-dim">The worker needs your Privy delegated Solana wallet id before it can execute calls while you are offline.</p>
          <a href="/wallet" className="mt-3 inline-flex rounded-md bg-toxic px-4 py-2 text-xs font-bold text-white shadow-toxic">Open Wallet</a>
        </div>
      )}

      {loaded && groups.length === 0 && (
        <div className="mt-6 grid place-items-center rounded-lg border border-edge bg-panel/40 py-12 text-center">
          <p className="text-sm font-bold text-dim">No call groups yet</p>
          <p className="mt-1 max-w-md font-mono text-[11px] text-dim/70">Sources appear after their owners add the bot, register a calls channel, and it is approved. Nothing is seeded, so every performance figure is earned from recorded calls.</p>
          <a href="/apply" className="mt-4 rounded-md border border-edge px-4 py-2 text-xs font-bold text-dim hover:border-toxic hover:text-toxic">List a server →</a>
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const on = copying.includes(g.id);
          const cfg = s(g.id);
          const invalidSettings = settingsError(cfg);
          return (
            <article key={g.id} className={`rounded-lg border bg-panel p-5 transition ${on ? "border-toxic/60 shadow-toxic" : "border-edge"}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-bold">
                    {g.publicSlug ? <Link href={`/source/${g.publicSlug}`} className="hover:text-toxic">{g.name}</Link> : g.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-xs text-dim">
                    {g.members ?? "—"} members · {g.metrics.calls} calls in the tracked window
                  </p>
                </div>
                <button onClick={() => toggle(g.id)} disabled={saving === g.id}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-60 ${on ? "bg-toxic" : "bg-edge"}`}
                  aria-label={`${on ? "Pause" : "Enable"} copying for ${g.name}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-void transition-all ${on ? "left-6" : "left-1"}`} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-4">
                <Metric label="2x hit rate" value={g.metrics.hitRate == null ? "Pending" : `${g.metrics.hitRate.toFixed(0)}%`} />
                <Metric label="Avg peak" value={g.metrics.avgPeakX == null ? "Pending" : `${g.metrics.avgPeakX.toFixed(2)}x`} tone="text-up" />
                <Metric label="Median peak" value={g.metrics.medianPeakX == null ? "Pending" : `${g.metrics.medianPeakX.toFixed(2)}x`} />
                <Metric label="Best call" value={g.metrics.bestPeakX == null ? "Pending" : `${g.metrics.bestPeakX.toFixed(1)}x`} tone="text-toxic" />
              </div>

              <p className="mt-3 min-h-10 font-mono text-[10px] leading-5 text-dim/75">
                {g.metrics.measuredCalls
                  ? `${g.metrics.measuredCalls}/${g.metrics.calls} calls have an entry and live peak measurement. 2x hit rate means the call reached at least 2.00x from its recorded entry.`
                  : "Metrics appear after the scanner records an entry price and checks the call against live market data."}
              </p>

              <div className="mt-4 flex gap-2">
                <button onClick={() => setOpen(g.id)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md bg-toxic px-3 text-xs font-bold text-[#17110c] transition hover:brightness-110">
                  <SlidersHorizontal size={14} /> Configure
                </button>
                {g.publicSlug && <Link href={`/source/${g.publicSlug}`} aria-label={`Open ${g.name} public profile`} title="Public profile" className="grid h-10 w-10 place-items-center rounded-md border border-edge text-dim transition hover:border-toxic hover:text-ink"><ExternalLink size={14} /></Link>}
              </div>
            </article>
          );
        })}
      </div>

      {open && groups.find((group) => group.id === open) && (() => {
        const group = groups.find((item) => item.id === open)!;
        const cfg = s(group.id);
        const invalidSettings = settingsError(cfg);
        const on = copying.includes(group.id);
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="bot-settings-title" className="max-h-[calc(100svh-3rem)] w-full max-w-4xl overflow-y-auto rounded-lg border border-edge bg-panel shadow-[0_30px_100px_rgba(0,0,0,.6)]">
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-edge bg-panel/95 px-5 py-4 backdrop-blur">
                <div><p className="font-mono text-[10px] uppercase text-toxic">Execution profile</p><h2 id="bot-settings-title" className="mt-1 text-lg font-bold">{group.name}</h2><p className="mt-1 text-xs text-dim">Rules apply only to new calls from this approved source.</p></div>
                <button onClick={() => setOpen(null)} aria-label="Close settings" className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-edge text-dim transition hover:border-toxic hover:text-ink"><X size={17} /></button>
              </header>
              <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  <NumberField label="Size per call" suffix="SOL" value={cfg.size} step={0.1} min={0.1} onChange={(value) => set(group.id, { size: value })} />
                  <NumberField label="Daily spend cap" suffix="SOL" value={cfg.dailyCap} step={0.5} min={0.5} onChange={(value) => set(group.id, { dailyCap: value })} />
                  <NumberField label="Take profit 1" suffix="x" value={cfg.tp1} step={0.5} min={1.5} onChange={(value) => set(group.id, { tp1: value })} />
                  <NumberField label="Sell at TP1" suffix="%" value={cfg.tp1sell} step={5} min={0} max={100} onChange={(value) => set(group.id, { tp1sell: value })} />
                  <NumberField label="Take profit 2" suffix="x" value={cfg.tp2} step={0.5} min={1.5} onChange={(value) => set(group.id, { tp2: value })} />
                  <NumberField label="Sell at TP2" suffix="%" value={cfg.tp2sell} step={5} min={0} max={100} onChange={(value) => set(group.id, { tp2sell: value })} />
                  <NumberField label="Stop loss" suffix="%" value={cfg.sl} step={5} min={1} max={100} onChange={(value) => set(group.id, { sl: value })} />
                  <NumberField label="Max slippage" suffix="%" value={cfg.slippage} step={0.5} min={0.5} max={20} onChange={(value) => set(group.id, { slippage: value })} />
                </div>
                <aside className="border-t border-edge bg-void/55 p-5 lg:border-l lg:border-t-0">
                  <p className="font-mono text-[10px] uppercase text-dim">Order summary</p>
                  <dl className="mt-4 space-y-3 text-xs"><Summary label="Per call" value={`${cfg.size} SOL`} /><Summary label="Profit exits" value={`${cfg.tp1sell + cfg.tp2sell}%`} /><Summary label="Runner" value={`${Math.max(0, 100 - cfg.tp1sell - cfg.tp2sell)}%`} /><Summary label="Daily limit" value={`${cfg.dailyCap} SOL`} /></dl>
                  <div className="mt-6 border-t border-edge pt-5"><p className="font-mono text-[10px] uppercase text-dim">Protection</p><div className="mt-3 space-y-2 text-xs text-ink">{["Rug risk screening", "Mint authority check", "Liquidity validation"].map((item) => <p key={item} className="flex items-center gap-2"><Check size={13} className="text-up" /> {item}</p>)}</div></div>
                  {group.recentCalls.length > 0 && <div className="mt-6 border-t border-edge pt-5"><p className="font-mono text-[10px] uppercase text-dim">Latest calls</p>{group.recentCalls.slice(0, 3).map((call) => <div key={call.id} className="mt-3 flex items-center justify-between gap-2 font-mono text-[10px]"><span className="truncate">{call.symbol || call.mint?.slice(0, 7)}</span><span className="text-up">{call.peakX ? `${call.peakX.toFixed(2)}x` : "Scanning"}</span></div>)}</div>}
                </aside>
              </div>
              <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-edge bg-panel/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <p className={`font-mono text-[10px] ${invalidSettings ? "text-hotpink" : "text-dim"}`}>{invalidSettings || (on ? "Changes update the active copy profile." : "Copying is paused. Settings can still be saved.")}</p>
                <div className="flex gap-2"><button onClick={() => setOpen(null)} className="min-h-10 rounded-md border border-edge px-4 text-xs font-bold text-dim transition hover:text-ink">Cancel</button><button onClick={() => persist(group.id, on)} disabled={saving === group.id || !!invalidSettings} className="min-h-10 min-w-36 rounded-md bg-toxic px-5 text-xs font-bold text-[#17110c] transition hover:brightness-110 disabled:opacity-50">{saving === group.id ? "Saving" : saved === group.id ? "Saved" : "Save profile"}</button></div>
              </footer>
            </section>
          </div>
        );
      })()}
    </>
  );
}

function NumberField({ label, suffix, value, step, min = 0, max = 1000, onChange }: { label: string; suffix: string; value: number; step: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const update = (next: number) => onChange(Math.min(max, Math.max(min, Number(next.toFixed(4)))));
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase text-dim">{label}</span>
      <span className="mt-1.5 flex min-h-11 items-center overflow-hidden rounded-md border border-edge bg-void focus-within:border-toxic">
        <button type="button" onClick={() => update(value - step)} aria-label={`Decrease ${label}`} className="grid h-11 w-11 shrink-0 place-items-center border-r border-edge text-dim transition hover:bg-edge/50 hover:text-ink"><Minus size={14} /></button>
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 appearance-none bg-transparent px-3 text-center font-mono text-sm outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
        <span className="font-mono text-[10px] text-dim">{suffix}</span>
        <button type="button" onClick={() => update(value + step)} aria-label={`Increase ${label}`} className="grid h-11 w-11 shrink-0 place-items-center border-l border-edge text-dim transition hover:bg-edge/50 hover:text-ink"><Plus size={14} /></button>
      </span>
    </label>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-panel px-4 py-3"><p className="font-mono text-[9px] uppercase text-dim">{label}</p><p className="mt-1 text-sm font-semibold text-ink">{value}</p></div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-dim">{label}</dt><dd className="font-mono text-ink">{value}</dd></div>;
}

function Metric({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-void px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase text-dim">{label}</p>
      <p className={`mt-1 font-mono text-sm font-bold ${tone}`}>{value}</p>
    </div>
  );
}
