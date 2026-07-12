"use client";
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getCallSources, getMySubscriptions, saveSubscription, type CallSource } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId } from "@/lib/solanaWallet";

type Settings = { size: number; tp1: number; tp1sell: number; tp2: number; tp2sell: number; sl: number; slippage: number; dailyCap: number };
const DEFAULTS: Settings = { size: 0.5, tp1: 2, tp1sell: 50, tp2: 5, tp2sell: 25, sl: 40, slippage: 3, dailyCap: 2 };

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
  const toast = useToast();

  const pubkey = getSolanaAddress(user);
  const walletId = getSolanaWalletId(user);

  async function persist(id: string, on: boolean) {
    if (!authenticated) { login(); return; }
    const token = await getAccessToken();
    const c = s(id);
    const { error } = await saveSubscription({
      group_id: id, size_sol: c.size, tp1: c.tp1, tp1_sell: c.tp1sell,
      tp2: c.tp2, tp2_sell: c.tp2sell, stop_loss: c.sl, slippage_bps: c.slippage * 100,
      daily_cap_sol: c.dailyCap, enabled: on, user_pubkey: pubkey, wallet_id: walletId
    }, token);
    if (error) { toast(error.message || "Could not save — sign in first", "err"); return; }
    setSaved(id); toast(on ? "Copying this group — saved" : "Settings saved"); setTimeout(() => setSaved(null), 1500);
  }

  function toggle(id: string) {
    const on = !copying.includes(id);
    setCopying(on ? [...copying, id] : copying.filter((x) => x !== id));
  }

  useEffect(() => {
    getCallSources().then((g) => { setGroups(g); setLive(g.length > 0); setLoaded(true); });
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
  }, [authenticated, getAccessToken]);

  const s = (id: string) => settings[id] ?? DEFAULTS;
  const set = (id: string, patch: Partial<Settings>) =>
    setSettings((prev) => ({ ...prev, [id]: { ...s(id), ...patch } }));

  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Discord Calls</h1>
        <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${live ? "border-toxic/50 text-toxic" : "border-edge text-dim"}`}>
          {live ? "● live from DB" : "○ none yet"}
        </span>
      </div>
      <p className="mt-1 text-sm text-dim">
        Compare independently tracked results, then tune your rules per source. Every call is
        rug-checked before your wallet moves.
      </p>

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
          return (
            <div key={g.id} className={`gradient-border rounded-lg border p-5 transition ${on ? "border-toxic/60 shadow-toxic" : "border-edge"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold">{g.name}</h3>
                  <p className="mt-0.5 font-mono text-xs text-dim">
                    {g.members ?? "—"} members · {g.metrics.calls} calls in the tracked window
                  </p>
                </div>
                <button onClick={() => toggle(g.id)}
                  className={`relative h-7 w-14 rounded-full transition ${on ? "bg-toxic" : "bg-edge"}`}
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
                    <span className="font-mono text-[11px] uppercase text-dim">TP1: sell {cfg.tp1sell}% at</span>
                    <input type="number" value={cfg.tp1} onChange={(e) => set(g.id, { tp1: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">TP2: sell {cfg.tp2sell}% at</span>
                    <input type="number" value={cfg.tp2} onChange={(e) => set(g.id, { tp2: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-toxic" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Max slippage %</span>
                    <input type="number" value={cfg.slippage} onChange={(e) => set(g.id, { slippage: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-cyber" />
                  </label>
                  <label className="block">
                    <span className="font-mono text-[11px] uppercase text-dim">Daily loss cap (SOL)</span>
                    <input type="number" step="0.5" value={cfg.dailyCap} onChange={(e) => set(g.id, { dailyCap: +e.target.value })}
                      className="mt-1 w-full rounded-md border border-edge bg-void px-3 py-2 font-mono outline-none focus:border-hotpink" />
                  </label>
                  <p className="col-span-2 rounded-md border border-edge bg-void px-3 py-2 font-mono text-[11px] text-dim">
                     rug-check on · mint-authority check · liquidity-lock check
                  </p>
                  <button onClick={() => persist(g.id, on)}
                    className="col-span-2 rounded-md bg-toxic py-2.5 text-sm font-bold text-white shadow-toxic transition hover:brightness-110">
                    {saved === g.id ? "✓ Saved" : "Save settings"}
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
