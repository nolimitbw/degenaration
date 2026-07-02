"use client";
import AppShell from "@/components/AppShell";
import { useEffect, useState } from "react";
import { getNet } from "@/lib/net";
import { usePrivy } from "@privy-io/react-auth";
import { getMyTrades, fetchBalance, getCommissionTotals, type Trade } from "@/lib/queries";

export default function Dashboard() {
  const { authenticated, user, login } = usePrivy();
  const address = (user as any)?.wallet?.address as string | undefined;
  const [balance, setBalance] = useState<number | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [feesPaid, setFeesPaid] = useState(0);

  useEffect(() => {
    if (address) fetchBalance(address, getNet()).then((b) => b && setBalance(b.sol));
    getMyTrades().then((t) => { setTrades(t); setFeesPaid(t.reduce((s, x) => s + Number(x.fee_sol || 0), 0)); });
  }, [address]);

  if (!authenticated) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md rounded-lg border border-edge bg-panel p-8 text-center">
          <h1 className="text-xl font-bold">Your portfolio</h1>
          <p className="mt-2 text-sm text-dim">Connect your wallet to see your real balance, positions and trade history.</p>
          <button onClick={login} className="mt-6 w-full rounded-md bg-toxic py-3 font-bold text-void shadow-toxic">Connect wallet</button>
        </div>
      </AppShell>
    );
  }

  const inPositions = 0; // real open positions require on-chain token-account read (per-token); shown once you trade
  return (
    <AppShell>
      <h1 className="text-2xl font-bold">Portfolio</h1>
      <p className="mt-1 text-sm text-dim">Live from your wallet on-chain. Nothing here is simulated.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Wallet balance</p>
          <p className="mt-2 font-mono text-2xl font-bold">{balance != null ? balance.toFixed(3) : "…"} <span className="text-base text-dim">SOL</span></p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Trades</p>
          <p className="mt-2 font-mono text-2xl font-bold">{trades ? trades.length : "…"}</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Fees paid (2%)</p>
          <p className="mt-2 font-mono text-2xl font-bold">{feesPaid.toFixed(3)} SOL</p>
        </div>
      </div>

      <h2 className="mt-10 text-lg font-bold">Trade history</h2>
      <div className="mt-3 rounded-lg border border-edge">
        {!trades ? (
          <p className="p-8 text-center text-sm text-dim">Loading…</p>
        ) : trades.length === 0 ? (
          <div className="grid place-items-center py-12 text-center">
            <p className="text-sm font-bold text-dim">No trades yet</p>
            <p className="mt-1 font-mono text-[11px] text-dim/70">Buy a token from the Terminal or Trenches and it will appear here.</p>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-panel font-mono text-[11px] uppercase text-dim"><tr>{["Time","Token","Side","Amount","Fee"].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} className="border-t border-edge font-mono text-xs">
                  <td className="px-4 py-3 text-dim">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-bold">{t.mint.slice(0,6)}…</td>
                  <td className="px-4 py-3">{(t.side||"").toUpperCase()}</td>
                  <td className="px-4 py-3">{t.sol_amount ?? "—"} SOL</td>
                  <td className="px-4 py-3 text-dim">{t.fee_sol ?? 0} SOL</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
