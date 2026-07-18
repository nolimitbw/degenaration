"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { Bot, Check, ExternalLink, Minus, Plus, RefreshCw, Search, WalletCards } from "lucide-react";
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
  const [selected, setSelected] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "all">("7d");
  const [sourceSearch, setSourceSearch] = useState("");
  const [settings, setSettings] = useState<Record<string, Settings>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
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

  async function loadSources(nextTimeframe = timeframe) {
    setLoaded(false);
    const g = await getCallSources(nextTimeframe).catch(() => []);
    setGroups(g);
    setSelected((current) => current && g.some((group) => group.id === current) ? current : g[0]?.id ?? null);
    setLive(g.length > 0);
    setLoaded(true);
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

  const s = (id: string) => settings[id] ?? DEFAULTS;
  const set = (id: string, patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, [id]: { ...s(id), ...patch } }));

  const activeGroup = groups.find((group) => group.id === selected) ?? null;
  const visibleGroups = groups.filter((group) => group.name.toLowerCase().includes(sourceSearch.trim().toLowerCase()));

  const cfg = activeGroup ? s(activeGroup.id) : DEFAULTS;
  const invalidSettings = activeGroup ? settingsError(cfg) : null;
  const active = activeGroup ? copying.includes(activeGroup.id) : false;

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-panel">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div className="flex items-center gap-3"><Bot size={18} className="text-toxic" /><div><h1 className="text-sm font-bold">Discord source automations</h1><p className="font-mono text-[9px] uppercase text-dim">Wallet-signed execution profiles</p></div></div>
        <div className="flex items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase ${live ? "border-up/35 text-up" : "border-edge text-dim"}`}><span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-up" : "bg-dim"}`} />{live ? "Sources online" : "No sources"}</span><button onClick={() => loadSources()} disabled={!loaded} aria-label="Refresh sources" title="Refresh sources" className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim transition hover:border-toxic hover:text-ink disabled:opacity-50"><RefreshCw size={14} className={!loaded ? "animate-spin" : ""} /></button></div>
      </header>

      {loaded && groups.length === 0 ? (
        <div className="grid min-h-[560px] place-items-center p-8 text-center"><div><p className="text-sm font-bold">No approved Discord sources</p><p className="mt-2 max-w-md text-xs leading-6 text-dim">Sources appear after a server owner registers a call channel and an administrator approves it.</p><Link href="/apply" className="mt-5 inline-flex min-h-10 items-center rounded-md bg-toxic px-4 text-xs font-bold text-[#17110c]">List a server</Link></div></div>
      ) : (
        <div className="grid xl:grid-cols-[minmax(0,1.05fr)_minmax(460px,.95fr)]">
          <section className="border-b border-edge xl:border-b-0 xl:border-r">
            {activeGroup ? <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge px-5 py-4">
                <div className="flex min-w-0 items-center gap-3"><SourceAvatar source={activeGroup} size="small" /><div className="min-w-0"><p className="font-mono text-[9px] uppercase text-toxic">Execution profile</p><h2 className="truncate text-base font-bold">{activeGroup.name}</h2><p className="mt-0.5 font-mono text-[10px] text-dim">{activeGroup.members ?? "--"} members · {activeGroup.metrics.calls} tracked calls</p></div></div>
                <button onClick={() => toggle(activeGroup.id)} disabled={saving === activeGroup.id} className={`inline-flex min-h-9 items-center gap-2 rounded-md border px-3 font-mono text-[10px] uppercase transition ${active ? "border-up/40 bg-up/5 text-up" : "border-edge text-dim hover:text-ink"}`}><span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-up" : "bg-dim"}`} />{active ? "Copying enabled" : "Copying paused"}</button>
              </div>

              <div className="space-y-5 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-edge bg-void px-3 py-3"><p className="font-mono text-[9px] uppercase text-dim">Execution wallet</p><div className="mt-2 flex items-center justify-between gap-3"><span className="truncate font-mono text-xs text-ink">{pubkey ? `${pubkey.slice(0, 6)}...${pubkey.slice(-5)}` : "Connect a wallet"}</span><WalletCards size={15} className={pubkey ? "text-toxic" : "text-dim"} /></div></div>
                  <div className="rounded-md border border-edge bg-void px-3 py-3"><p className="font-mono text-[9px] uppercase text-dim">Offline execution</p><div className="mt-2 flex items-center justify-between gap-3"><span className="font-mono text-xs text-ink">{delegated && automation.live ? "Ready" : delegated ? "Engine paused" : "Delegation required"}</span><span className={`h-2 w-2 rounded-full ${delegated && automation.live ? "bg-up" : "bg-down"}`} /></div></div>
                </div>

                {authenticated && pubkey && (!walletId || !delegated) && <Link href="/wallet" className="flex items-center justify-between rounded-md border border-down/35 bg-down/5 px-3 py-2.5 text-xs text-ink"><span>Enable delegated trading before activating this profile.</span><span className="font-semibold text-down">Open wallet</span></Link>}

                <div>
                  <SectionTitle title="Position controls" description="Capital limits applied to every new source call." />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label="Size per call" suffix="SOL" value={cfg.size} step={0.1} min={0.1} onChange={(value) => set(activeGroup.id, { size: value })} /><NumberField label="Daily spend cap" suffix="SOL" value={cfg.dailyCap} step={0.5} min={0.5} onChange={(value) => set(activeGroup.id, { dailyCap: value })} /></div>
                </div>

                <div>
                  <SectionTitle title="Profit ladder" description="Take partial profit while keeping a runner position." />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label="First target" suffix="x" value={cfg.tp1} step={0.5} min={1.5} onChange={(value) => set(activeGroup.id, { tp1: value })} /><NumberField label="Sell at first target" suffix="%" value={cfg.tp1sell} step={5} min={0} max={100} onChange={(value) => set(activeGroup.id, { tp1sell: value })} /><NumberField label="Second target" suffix="x" value={cfg.tp2} step={0.5} min={1.5} onChange={(value) => set(activeGroup.id, { tp2: value })} /><NumberField label="Sell at second target" suffix="%" value={cfg.tp2sell} step={5} min={0} max={100} onChange={(value) => set(activeGroup.id, { tp2sell: value })} /></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-edge"><div className="h-full bg-up" style={{ width: `${Math.min(100, cfg.tp1sell + cfg.tp2sell)}%` }} /></div><div className="mt-1.5 flex justify-between font-mono text-[9px] text-dim"><span>{cfg.tp1sell + cfg.tp2sell}% exits</span><span>{Math.max(0, 100 - cfg.tp1sell - cfg.tp2sell)}% runner</span></div>
                </div>

                <div>
                  <SectionTitle title="Risk controls" description="Hard exits and route tolerance for automated orders." />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label="Stop loss" suffix="%" value={cfg.sl} step={5} min={1} max={100} onChange={(value) => set(activeGroup.id, { sl: value })} /><NumberField label="Max slippage" suffix="%" value={cfg.slippage} step={0.5} min={0.5} max={20} onChange={(value) => set(activeGroup.id, { slippage: value })} /></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">{["Rug screening", "Mint authority", "Liquidity check"].map((item) => <div key={item} className="flex min-h-9 items-center gap-2 rounded-md border border-edge bg-void px-3 text-[10px] text-ink"><Check size={12} className="text-up" />{item}</div>)}</div>
                </div>
              </div>

              <footer className="sticky bottom-9 z-10 flex flex-col gap-3 border-t border-edge bg-panel/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between"><p className={`font-mono text-[10px] ${invalidSettings ? "text-down" : "text-dim"}`}>{invalidSettings || (active ? "Saving updates the live execution profile." : "Profile is paused; settings can still be saved.")}</p><button onClick={() => persist(activeGroup.id, active)} disabled={saving === activeGroup.id || !!invalidSettings} className="min-h-10 min-w-40 rounded-md bg-toxic px-5 text-xs font-bold text-[#17110c] transition hover:brightness-110 disabled:opacity-50">{saving === activeGroup.id ? "Saving profile" : saved === activeGroup.id ? "Profile saved" : "Save execution profile"}</button></footer>
            </> : <div className="grid min-h-[640px] place-items-center text-sm text-dim">Select a Discord source.</div>}
          </section>

          <aside className="bg-void/35">
            <div className="border-b border-edge p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-mono text-[9px] uppercase text-toxic">Source intelligence</p><h2 className="mt-1 text-base font-bold">Approved Discord servers</h2></div><div className="flex gap-1">{(["7d", "30d", "all"] as const).map((value) => <button key={value} onClick={() => { setTimeframe(value); loadSources(value); }} className={`min-h-8 rounded-md px-2.5 font-mono text-[9px] uppercase transition ${timeframe === value ? "bg-toxic text-[#17110c]" : "border border-edge text-dim hover:text-ink"}`}>{value}</button>)}</div></div>
              {activeGroup && <div className="mt-4 grid grid-cols-5 gap-px bg-edge">{[["Calls", activeGroup.metrics.calls], ["Measured", activeGroup.metrics.measuredCalls], ["2x rate", activeGroup.metrics.hitRate == null ? "--" : `${activeGroup.metrics.hitRate.toFixed(0)}%`], ["Avg peak", activeGroup.metrics.avgPeakX == null ? "--" : `${activeGroup.metrics.avgPeakX.toFixed(2)}x`], ["Best", activeGroup.metrics.bestPeakX == null ? "--" : `${activeGroup.metrics.bestPeakX.toFixed(1)}x`]].map(([label, value]) => <div key={label} className="bg-panel px-2 py-3 text-center"><p className="font-mono text-sm font-bold text-ink">{value}</p><p className="mt-1 font-mono text-[8px] uppercase text-dim">{label}</p></div>)}</div>}
              <label className="mt-4 flex min-h-10 items-center gap-2 rounded-md border border-edge bg-panel px-3 focus-within:border-toxic"><Search size={14} className="text-dim" /><input value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Search approved sources" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">{visibleGroups.map((group) => <button key={group.id} onClick={() => setSelected(group.id)} className={`overflow-hidden rounded-md border bg-panel text-left transition ${selected === group.id ? "border-toxic shadow-toxic" : "border-edge hover:border-toxic/60"}`}><SourceAvatar source={group} size="card" /><div className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-bold text-ink">{group.name}</p><p className="mt-1 font-mono text-[9px] text-dim">{group.members ?? "--"} members</p></div>{selected === group.id && <Check size={14} className="shrink-0 text-toxic" />}</div><div className="mt-3 flex items-center justify-between border-t border-edge pt-2 font-mono text-[9px]"><span className="text-dim">{group.metrics.calls} calls</span><span className={group.metrics.hitRate == null ? "text-dim" : "text-up"}>{group.metrics.hitRate == null ? "Measuring" : `${group.metrics.hitRate.toFixed(0)}% hit`}</span></div></div></button>)}</div>
            {!visibleGroups.length && loaded && <p className="p-10 text-center text-xs text-dim">No approved sources match that search.</p>}
            {activeGroup?.publicSlug && <div className="px-4 pb-5"><Link href={`/source/${activeGroup.publicSlug}`} className="inline-flex items-center gap-2 text-xs text-dim transition hover:text-toxic">Open public source profile <ExternalLink size={13} /></Link></div>}
          </aside>
        </div>
      )}
    </div>
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

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-edge pb-2">
      <h3 className="text-xs font-bold text-ink">{title}</h3>
      <p className="font-mono text-[9px] text-dim">{description}</p>
    </div>
  );
}

function SourceAvatar({ source, size }: { source: CallSource; size: "small" | "card" }) {
  const image = source.avatarUrl || (/degen.?aration/i.test(source.name) ? "/images/rocket-launch-hero.png" : null);
  if (image) return <img src={image} alt="" className={size === "small" ? "h-11 w-11 shrink-0 rounded-md object-cover" : "aspect-[16/9] w-full object-cover"} />;
  const initials = source.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  return <div className={`grid place-items-center bg-[linear-gradient(135deg,rgb(var(--toxic-rgb)/.28),rgb(var(--edge-rgb)/.35))] font-mono font-bold text-toxic ${size === "small" ? "h-11 w-11 shrink-0 rounded-md text-xs" : "aspect-[16/9] w-full text-2xl"}`}>{initials}</div>;
}
