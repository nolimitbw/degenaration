"use client";
import AppShell from "@/components/AppShell";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { getNet } from "@/lib/net";
import { fetchPortfolio, fmtUsd, fmtAmt, type Portfolio } from "@/lib/queries";

const ALLOC_COLORS = ["#a3ff12", "#7b5cff", "#ff2d78", "#12c2ff", "#ffb800", "#8b8b9e"];

export default function Holdings() {
  const { authenticated, user, login } = usePrivy();
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const pubkey = (user as any)?.wallet?.address as string | undefined;

  const load = useCallback(async () => {
    if (!pubkey) { setLoading(false); return; }
    const p = await fetchPortfolio(pubkey, getNet());
    if (p && !(p as any).error) setPf(p);
    setLoading(false);
  }, [pubkey]);

  useEffect(() => {
    setLoading(true); load();
    const iv = setInterval(load, 30000); // portfolio refresh
    return () => clearInterval(iv);
  }, [load]);

  if (!authenticated) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-lg border border-edge bg-panel p-8 text-center">
          <h1 className="text-xl font-bold">Your holdings</h1>
          <p className="mt-2 text-sm text-dim">Connect your wallet to see your real on-chain positions, live value and allocation.</p>
          <button onClick={login} className="mt-6 w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic">Connect wallet</button>
        </div>
      </AppShell>
    );
  }

  const positions = pf?.positions ?? [];
  const total = pf?.totalUsd ?? 0;
  // allocation across SOL + top tokens
  const alloc = [
    { label: "SOL", value: pf?.solUsd ?? 0 },
    ...positions.slice(0, 5).map((p) => ({ label: p.symbol ?? p.mint.slice(0, 4), value: p.valueUsd ?? 0 }))
  ].filter((a) => a.value > 0);

  return (
    <AppShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">Holdings
            <span className="rounded-full border border-toxic/40 px-2 py-0.5 font-mono text-[10px] text-toxic">LIVE</span>
          </h1>
          <p className="mt-1 text-sm text-dim">Your real on-chain positions, priced live. Refreshes every 30s.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Total value</p>
          <p className="mt-2 font-mono text-2xl font-bold">{loading && !pf ? "…" : fmtUsd(total)}</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">SOL balance</p>
          <p className="mt-2 font-mono text-2xl font-bold">{pf ? pf.sol.toFixed(3) : "…"} <span className="text-base text-dim">SOL</span></p>
          <p className="mt-0.5 font-mono text-xs text-dim">{pf ? fmtUsd(pf.solUsd) : ""}</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Token positions</p>
          <p className="mt-2 font-mono text-2xl font-bold">{pf ? pf.count : "…"}</p>
        </div>
      </div>

      {/* allocation bar */}
      {alloc.length > 0 && total > 0 && (
        <div className="mt-6">
          <div className="flex h-3 overflow-hidden rounded-full border border-edge">
            {alloc.map((a, i) => (
              <div key={a.label} style={{ width: `${(a.value / total) * 100}%`, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} title={`${a.label} ${fmtUsd(a.value)}`} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-dim">
            {alloc.map((a, i) => (
              <span key={a.label} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
                {a.label} {((a.value / total) * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* positions table */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-edge">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-panel font-mono text-[11px] uppercase text-dim">
            <tr>{["Token", "Amount", "Price", "24h", "Value", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading && !pf && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} className="border-t border-edge"><td colSpan={6} className="px-4 py-4"><div className="h-5 w-full animate-pulse rounded bg-edge/40" /></td></tr>
            ))}
            {pf && positions.map((p) => (
              <tr key={p.mint} className="border-t border-edge">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {p.image ? <img src={p.image} alt="" className="h-7 w-7 rounded-full" /> : <div className="grid h-7 w-7 place-items-center rounded-full bg-edge font-mono text-[10px]">{(p.symbol ?? "?").slice(0, 2)}</div>}
                    <div className="min-w-0"><p className="truncate font-mono font-bold">{p.symbol ?? p.mint.slice(0, 6)}</p><p className="truncate font-mono text-[10px] text-dim">{p.name ?? ""}</p></div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{fmtAmt(p.amount)}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.priceUsd != null ? fmtUsd(p.priceUsd) : "—"}</td>
                <td className={`px-4 py-3 font-mono text-xs ${(p.change24h ?? 0) >= 0 ? "text-toxic" : "text-hotpink"}`}>{p.change24h != null ? `${p.change24h >= 0 ? "+" : ""}${p.change24h.toFixed(1)}%` : "—"}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold">{fmtUsd(p.valueUsd)}</td>
                <td className="px-4 py-3"><Link href={`/terminal?mint=${p.mint}`} className="rounded border border-edge px-3 py-1.5 text-xs font-bold text-dim hover:border-toxic hover:text-toxic">Trade</Link></td>
              </tr>
            ))}
            {pf && !positions.length && (
              <tr className="border-t border-edge"><td colSpan={6} className="px-4 py-12 text-center">
                <p className="text-sm font-bold text-dim">No token positions</p>
                <p className="mt-1 font-mono text-[11px] text-dim/70">Buy a token from the Terminal or Trenches and it will show up here with live value.</p>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
