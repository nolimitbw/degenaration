"use client";
import AppShell from "@/components/AppShell";
import AdminGuard from "@/components/AdminGuard";
import { useEffect, useState } from "react";
import { fetchBalance } from "@/lib/queries";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { adminFetchJson, emailFromPrivyUser, useIsAdmin } from "@/lib/admin";

// The platform fee wallet (2% commissions land here). Set to your fee wallet address.
const FEE_WALLET = process.env.NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT || "";
type FeeConfig = { platformFeeBps?: number; feeWalletConfigured?: boolean; publicFeeWallet?: string | null; withdrawalsConfigured?: boolean };

export default function Commissions() {
  const { getAccessToken, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { admin } = useIsAdmin();
  const email = emailFromPrivyUser(user);
  const [totals, setTotals] = useState({ totalSol: 0, count: 0 });
  const [balance, setBalance] = useState<number | null>(null);
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState<FeeConfig>({});

  useEffect(() => {
    if (!admin) return;
    adminFetchJson<{ summary?: any }>("/api/admin/summary", getAccessToken, identityToken, email)
      .then((res) => {
        if (!res.ok) {
          setStatus(res.error);
          return;
        }
        const d = res.data;
        setTotals({ totalSol: Number(d.summary?.commissionSol || 0), count: Number(d.summary?.tradeCount || 0) });
        setFee({
          platformFeeBps: Number(d.summary?.platformFeeBps || 0),
          feeWalletConfigured: Boolean(d.summary?.feeWalletConfigured),
          publicFeeWallet: d.summary?.publicFeeWallet || null,
          withdrawalsConfigured: Boolean(d.summary?.withdrawalsConfigured)
        });
      })
      .catch(() => {});
    if (FEE_WALLET) fetchBalance(FEE_WALLET).then((b) => { if (b && !b.error) setBalance(b.sol); });
  }, [admin, email, getAccessToken, identityToken]);

  async function withdraw() {
    setStatus(null);
    if (!fee.feeWalletConfigured || !FEE_WALLET) { setStatus("Set PLATFORM_FEE_ACCOUNT and NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT to your fee wallet first."); return; }
    if (!fee.withdrawalsConfigured) { setStatus("Set ADMIN_WALLETS or PLATFORM_FEE_ACCOUNT before withdrawing."); return; }
    const sol = (window as any).solana;
    if (!sol?.isPhantom) { setStatus("Connect Phantom (the fee wallet) to sign the withdrawal."); return; }
    setBusy(true);
    try {
      await sol.connect();
      const owner = sol.publicKey?.toBase58();
      if (owner !== FEE_WALLET) { setStatus("Connected wallet is not the fee wallet."); setBusy(false); return; }
      const res = await adminFetchJson<any>("/api/withdraw", getAccessToken, identityToken, email, {
        method: "POST",
        body: JSON.stringify({ from: FEE_WALLET, to: dest, amountSol: amount })
      });
      if (!res.ok) throw new Error(res.error);
      const web3 = await import("@solana/web3.js");
      const tx = (web3 as any).Transaction.from(Uint8Array.from(atob(res.data.transaction), (c) => c.charCodeAt(0)));
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
      <p className="mt-1 text-sm text-dim">
        Platform fees only accrue when the fee wallet is configured. Withdrawals are owner-gated and signed by the fee wallet.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Total commissions earned</p>
          <p className="mt-2 font-mono text-2xl font-bold text-toxic">{totals.totalSol.toFixed(3)} SOL</p>
          <p className="mt-1 font-mono text-[11px] text-dim">{totals.count} trades</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Fee wallet balance</p>
          <p className="mt-2 font-mono text-2xl font-bold">{balance != null ? balance.toFixed(3) : "—"} SOL</p>
          <p className="mt-1 truncate font-mono text-[11px] text-dim">{fee.publicFeeWallet || FEE_WALLET || "not configured"}</p>
        </div>
        <div className="gradient-border rounded-lg border border-edge p-5">
          <p className="text-xs uppercase text-dim">Fee status</p>
          <p className="mt-2 font-mono text-2xl font-bold">{fee.platformFeeBps ? `${(fee.platformFeeBps / 100).toFixed(1)}%` : "Off"}</p>
          <p className="mt-1 font-mono text-[11px] text-dim">{fee.feeWalletConfigured ? "wallet configured" : "no fee wallet set"}</p>
        </div>
      </div>

      {!fee.feeWalletConfigured && (
        <p className="mt-6 rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 font-mono text-xs text-hotpink">
          Fees are currently disabled in production because PLATFORM_FEE_ACCOUNT is not set. Set PLATFORM_FEE_ACCOUNT and NEXT_PUBLIC_PLATFORM_FEE_ACCOUNT to the same fee wallet to enable commission accrual and withdrawals.
        </p>
      )}

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
        <button onClick={withdraw} disabled={busy || !fee.feeWalletConfigured || !dest || amount <= 0}
          className="mt-5 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">
          {busy ? "Signing…" : "Withdraw to my wallet"}
        </button>
        {status && <p className="mt-3 break-all font-mono text-[11px] text-dim">{status}</p>}
      </div>
    </AppShell>
    </AdminGuard>
  );
}
