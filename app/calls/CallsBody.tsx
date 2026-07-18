"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { getCallSources, getMySubscriptions, saveSubscription, type CallSource } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";
import { useAutomationStatus } from "@/lib/useAutomationStatus";

type Settings = { size: number; tp1: number; tp1sell: number; tp2: number; tp2sell: number; sl: number; slippage: number; dailyCap: number };
const DEFAULTS: Settings = { size: 0.5, tp1: 2, tp1sell: 50, tp2: 5, tp2sell: 25, sl: 40, slippage: 3, dailyCap: 2 };
const CALLS_UI_VERSION = "calls-copy-v2";

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

  const s = (id: string) => settings[id] ?? DEFAULTS;
  const set = (id: string, patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, [id]: { ...s(id), ...patch } }));

  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Bots</h1>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${live ? "border-toxic/50 text-toxic" : "border-edge text-dim"}`}>
          {live ? "● live from DB" : "○ none yet"}
        </span>
        <span className="rounded border border-toxic/40 bg-toxic/10 px-2 py-1 font-mono text-[10px] text-toxic">{CALLS_UI_VERSION}</span>
      </div>
      <p className="mt-1 text-sm text-dim">
        Build source-copy automations from independently tracked Discord calls, then tune the execution rules for each server.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-panel/70 p-3">
        <button onClick={loadSources} disabled={!loaded}
          className="rounded-md border border-edge px-3 py-1.5 text-xs font-bold text-ink hover:border-toxic disabled:opacity-50">
          {loaded ? "Refresh sources" : "Loading sources"}
        </button>
        <span className="font-mono text-[11px] text-dim">{groups.length} approved source{groups.length === 1 ? "" : "s"}</span>
        {lastSync && <span className="font-mono text-[11px] text-dim">synced {lastSync.toLocaleTimeString()}</span>}
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
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {groups.map((g) => {
          const on = copying.includes(g.id);
          const cfg = s(g.id);
          const invalidSettings = settingsError(cfg);
          return (
            <div key={g.id} className={`gradient-border rounded-lg border p-5 transition ${on ? "border-toxic/60 shadow-toxic" : "border-edge"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold">
                    {g.publicSlug ? <Link href={`/source/${g.publicSlug}`} className="hover:text-toxic">{g.name}</Link> : g.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-xs text-dim">
                    {g.members ?? "—"} members · {g.metrics.calls} calls in the tracked window
                  </p>
                </div>
                <button onClick={() => toggle(g.id)} disabled={saving === g.id}
                  className={`relative h-7 w-14 rounded-full transition disabled:opacity-60 ${on ? "bg-toxic" : "bg-edge"}`}
                  aria-label="toggle copying">
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-void transition-all ${on ? "left-8" : "left-1"}`} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-4">
                <Metric label="2x hit rate" value={g.metrics.hitRate == null ? "Pending" : `${g.metrics.hitRate.toFixed(0)}%`} />
                <Metric label="Avg peak" value={g.metrics.avgPeakX == null ? "Pending" : `${g.metrics.avgPeakX.toFixed(2)}x`} tone="text-up" />
                <Metric label="Median peak" value={g.metrics.medianPeakX == null ? "Pending" : `${g.metrics.medianPeakX.toFixed(2)}x`} />
                <Metric label="Best call" value={g.metrics.bestPeakX == null ? "Pending" : `${g.metrics.bestPeakX.toFixed(1)}x`} tone="text-toxic" />
              </div>

              <p className="mt-3 font-mono text-[10px] text-dim/75">
                {g.metrics.measuredCalls
                  ? `${g.metrics.measuredCalls}/${g.metrics.calls} calls have an entry and live peak measurement. 2x hit rate means the call reached at least 2.00x from its recorded entry.`
                  : "Metrics appear after the scanner records an entry price and checks the call against live market data."}
              </p>

              <button onClick={() => setOpen(open === g.id ? null : g.id)}
                className="mt-4 w-full rounded-md border border-edge py-2 font-mono text-xs text-dim transition hover:border-cyber hover:text-ink">
                {open === g.id ? "▲ hide settings" : "▼ trade settings"}
              </button>

              {open === g.id && (
                <div className="mt-4 grid grid-cols-2 gap-4 border-t border-edge pt-4 text-sm">
                  {g.recentCalls.length > 0 && (
                    <div className="col-span-2 overflow-hidden rounded-md border border-edge">
                      <div className="border-b border-edge bg-void px-3 py-2 font-mono text-[10px] uppercase text-dim">Latest recorded calls</div>
                      {g.recentCalls.map((call) => (
                        <div key={call.id} className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2 last:border-b-0">
                          <span className="min-w-0 truncate font-mono text-xs text-ink">{call.symbol || call.mint?.slice(0, 8) || "Unknown token"}</span>
                          <span className="truncate font-mono text-[10px] text-dim">{call.caller || "Channel call"}</span>
                          <span className={`font-mono text-xs font-bold ${call.peakX && call.peakX >= 1 ? "text-up" : "text-dim"}`}>{call.peakX ? `${call.peakX.toFixed(2)}x peak` : "Scanning"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Size per call (SOL)</span>
                    <input type="number" step="0.1" value={cfg.size} onChange={(e) => set(g.id, { size: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Stop-loss (-%)</span>
                    <input type="number" value={cfg.sl} onChange={(e) => set(g.id, { sl: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-hotpink" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">TP1 target (x)</span>
                    <input type="number" value={cfg.tp1} onChange={(e) => set(g.id, { tp1: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Sell at TP1 (%)</span>
                    <input type="number" value={cfg.tp1sell} onChange={(e) => set(g.id, { tp1sell: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">TP2 target (x)</span>
                    <input type="number" value={cfg.tp2} onChange={(e) => set(g.id, { tp2: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Sell at TP2 (%)</span>
                    <input type="number" value={cfg.tp2sell} onChange={(e) => set(g.id, { tp2sell: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Max slippage %</span>
                    <input type="number" value={cfg.slippage} onChange={(e) => set(g.id, { slippage: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-cyber" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Daily spend cap (SOL)</span>
                    <input type="number" step="0.5" value={cfg.dailyCap} onChange={(e) => set(g.id, { dailyCap: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-hotpink" />
                  </label>
                  <p className={`col-span-2 rounded-md border px-3 py-2 font-mono text-[11px] ${invalidSettings ? "border-hotpink/40 bg-hotpink/5 text-hotpink" : "border-edge bg-void text-dim"}`}>
                    {invalidSettings || "rug-check on · mint-authority check · liquidity-lock check"}
                  </p>
                  <button onClick={() => persist(g.id, on)}
                    disabled={saving === g.id || !!invalidSettings}
                    className="col-span-2 rounded-md bg-toxic py-2.5 text-sm font-bold text-white shadow-toxic transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                    {saving === g.id ? "Saving..." : saved === g.id ? "Saved" : "Save settings"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Metric({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-void px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase text-dim">{label}</p>
      <p className={`mt-1 font-mono text-sm font-bold ${tone}`}>{value}</p>
    </div>
  );
}
