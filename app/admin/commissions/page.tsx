"use client";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { useEffect, useState } from "react";
import { fetchBalance } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { usePrivy } from "@privy-io/react-auth";
import { adminHeaders } from "@/lib/admin";

// The platform fee wallet (2% commissions land here). Set to your fee wallet address.
const FEE_WALLET = process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT || "";

export default function Commissions() {
  const { getAccessToken } = usePrivy();
  const [totals, setTotals] = useState({ totalSol: 0, count: 0 });
  const [balance, setBalance] = useState<number | null>(null);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminHeaders(getAccessToken)
      .then((headers) => fetch("/api/admin/summary", { headers }))
      .then((r) => r.json())
      .then((d) => setTotals({ totalSol: Number(d?.summary?.commissionSol || 0), count: Number(d?.summary?.tradeCount || 0) }))
      .catch(() => {});
    if (FEE_WALLET) fetchBalance(FEE_WALLET).then((b) => { if (b && !b.error) setBalance(b.sol); });
  }, [getAccessToken]);

  async function withdraw() {
    setStatus(null);
    if (!FEE_WALLET) { setStatus("Set NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT to your fee wallet first."); return; }
    const sol = (window as any).solana;
    if (!sol?.isPhantom) { setStatus("Connect Phantom (the fee wallet) to sign the withdrawal."); return; }
    setBusy(true);
    try {
      await sol.connect();
      const owner = sol.publicKey?.toBase58();
      if (owner !== FEE_WALLET) { setStatus("Connected wallet is not the fee wallet."); setBusy(false); return; }
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
        },
        body: JSON.stringify({ from: FEE_WALLET, to: dest, amountSol: amount })
      }).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      const web3 = await import("@solana/web3.js");
      const tx = (web3 as any).Transaction.from(Uint8Array.from(atob(res.transaction), (c) => c.charCodeAt(0)));
      const sig = await sol.signAndSendTransaction(tx);
      setStatus(`✓ Withdrawal sent: ${sig.signature ?? sig}`);
    } catch (e: any) {
      setStatus(e.message);
    }
    setBusy(false);
  }

  return (
    <AdminGuard>
    <AppShell>
      <h1 className="text-2xl font-bold">Commissions & withdrawal</h1>
      <p className="mt-1 text-sm text-dim">Your 2% platform fee on every trade lands in the fee wallet. Withdraw anytime.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Total commissions earned</p>
          <p className="mt-2 font-mono text-2xl font-bold text-toxic">{totals.totalSol.toFixed(3)} SOL</p>
          <p className="mt-1 font-mono text-[11px] text-dim">{totals.count} trades</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Fee wallet balance</p>
          <p className="mt-2 font-mono text-2xl font-bold">{balance != null ? balance.toFixed(3) : "—"} SOL</p>
          <p className="mt-1 truncate font-mono text-[11px] text-dim">{FEE_WALLET || "not configured"}</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Fee rate</p>
          <p className="mt-2 font-mono text-2xl font-bold">2.0%</p>
          <p className="mt-1 font-mono text-[11px] text-dim">per trade, in & out</p>
        </div>
      </div>

      <div className="mt-8 max-w-lg rounded-lg border border-edge bg-panel p-6">
        <h2 className="font-bold">Withdraw commissions</h2>
        <p className="mt-1 text-xs text-dim">Sign with the fee wallet in Phantom. Funds move directly on-chain — the platform never holds keys.</p>
        <label className="mt-4 block">
          <span className="font-mono text-[11px] uppercase text-dim">Destination address</span>
          <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Your Solana address"
            className="mt-1 w-full rounded-md border border-edge bg-void px-4 py-3 font-mono text-sm outline-none focus:border-toxic" />
        </label>
        <label className="mt-3 block">
          <span className="font-mono text-[11px] uppercase text-dim">Amount (SOL)</span>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(+e.target.value)}
            className="mt-1 w-full rounded-md border border-edge bg-void px-4 py-3 font-mono text-sm outline-none focus:border-toxic" />
        </label>
        <button onClick={withdraw} disabled={busy || !dest || amount <= 0}
          className="mt-5 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
          {busy ? "Signing…" : "Withdraw to my wallet"}
        </button>
        {status && <p className="mt-3 break-all font-mono text-[11px] text-dim">{status}</p>}
      </div>
    </AppShell>
    </AdminGuard>
  );
}
