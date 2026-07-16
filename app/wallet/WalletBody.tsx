"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { getNet } from "@/lib/net";
import { usePrivy } from "@privy-io/react-auth";
import { getMyProfile, saveProfileLimits, fetchBalance } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress } from "@/lib/solanaWallet";

// Heavy signing panels load after the deposit/balance UI paints.
const SwapPanel = dynamic(() => import("@/components/SwapPanel"), { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-lg border border-edge bg-panel/40" /> });
const AutoTrade = dynamic(() => import("@/components/AutoTrade"), { ssr: false, loading: () => <div className="h-40 animate-pulse rounded-lg border border-edge bg-panel/40" /> });

// Privy-dependent wallet hub (deposit, limits, auto-trade, swap). Lazily loaded by page.tsx.
export default function WalletBody() {
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const toast = useToast();
  const address = getSolanaAddress(user);

  const [copied, setCopied] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [maxTrade, setMaxTrade] = useState(0.5);
  const [dailyCap, setDailyCap] = useState(2);
  const [savedLimits, setSavedLimits] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    getAccessToken().then((token) => getMyProfile(token)).then((p) => {
      if (p) { setMaxTrade(p.max_trade_sol ?? 0.5); setDailyCap(p.daily_cap_sol ?? 2); }
    }).catch(() => {});
  }, [address, authenticated, getAccessToken]);

  async function loadBalance() {
    if (!address) return;
    setBalanceLoading(true);
    setBalanceError(null);
    const snapshot = await fetchBalance(address, getNet());
    setBalanceLoading(false);
    if (!snapshot || snapshot.error) {
      setBalance(null);
      setBalanceError(snapshot?.error || "Balance unavailable");
      return;
    }
    setBalance(Number(snapshot.sol) || 0);
  }

  useEffect(() => { loadBalance(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [address]);

  const copy = () => { if (!address) return; navigator.clipboard?.writeText(address); setCopied(true); toast("Address copied"); setTimeout(() => setCopied(false), 1500); };
  async function saveLimits() {
    if (!Number.isFinite(maxTrade) || maxTrade <= 0) { toast("Max per trade must be above 0 SOL", "err"); return; }
    if (!Number.isFinite(dailyCap) || dailyCap < maxTrade) { toast("Daily cap must be at least max per trade", "err"); return; }
    const { error } = await saveProfileLimits(
      { max_trade_sol: maxTrade, daily_cap_sol: dailyCap, wallet_address: address },
      await getAccessToken()
    );
    if (error) { toast("Could not save — sign in first", "err"); return; }
    setSavedLimits(true); toast("Trade limits saved"); setTimeout(() => setSavedLimits(false), 1500);
  }

  if (!authenticated || !address) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-edge bg-panel p-8 text-center">
        <h1 className="text-xl font-bold">Connect your wallet</h1>
        <p className="mt-2 text-sm text-dim">Sign in to create your non-custodial Solana wallet or connect Phantom / Solflare / Backpack.</p>
        <button onClick={login} className="mt-6 w-full rounded-md bg-toxic py-3 font-bold text-white shadow-toxic transition hover:brightness-110">Connect wallet</button>
        <p className="mt-3 font-mono text-[11px] text-dim">Trade-only permission · spending caps · revocable · we never hold your keys</p>
      </div>
    );
  }

  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&bgcolor=08090c&color=22e07a&data=${address}`;

  return (
    <>
      <h1 className="text-2xl font-bold">Wallet</h1>
      <p className="mt-1 text-sm text-dim">Fund your non-custodial wallet and set trade-only limits. We can trade within these caps — never withdraw.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="gradient-border rounded-lg border border-edge p-5">
          <h2 className="font-bold">Deposit SOL </h2>
          <div className="mt-4 flex flex-col items-center gap-4">
            <img src={qr} alt="deposit QR" className="rounded-md border border-edge bg-void" width={180} height={180} />
            <div className="w-full">
              <p className="font-mono text-[11px] uppercase text-dim">Your deposit address</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-edge bg-void px-3 py-2 font-mono text-xs">{address}</code>
                <button onClick={copy} className="rounded-md bg-toxic px-3 py-2 text-xs font-bold text-white">{copied ? "✓" : "Copy"}</button>
              </div>
            </div>
            <p className="w-full rounded-md border border-hotpink/40 bg-hotpink/5 px-3 py-2 text-center font-mono text-[11px] text-hotpink">Send only mainnet SOL. Transfers are irreversible.</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="gradient-border rounded-lg border border-edge p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase text-dim">Balance</p>
                <p className="mt-1 font-mono text-3xl font-bold">{balanceLoading ? "…" : balance != null ? balance.toFixed(3) : "—"} <span className="text-base text-dim">SOL</span></p>
                <p className="mt-1 font-mono text-xs text-dim">{balanceError ? balanceError : "mainnet"}</p>
              </div>
              <button onClick={loadBalance} disabled={balanceLoading}
                className="rounded-md border border-edge px-3 py-1.5 font-mono text-[11px] font-bold text-dim transition hover:border-toxic hover:text-toxic disabled:opacity-50">
                {balanceLoading ? "Checking" : "Refresh"}
              </button>
            </div>
          </div>
          <div className="gradient-border rounded-lg border border-edge p-5">
            <h2 className="font-bold">Trade permission</h2>
            <p className="mt-1 text-xs text-dim">Hard limits on what the auto-trader can spend. Change or revoke anytime.</p>
            <label className="mt-4 block">
              <span className="flex justify-between font-mono text-[11px] uppercase text-dim"><span>Max per trade</span><span className="text-ink">{maxTrade} SOL</span></span>
              <input type="range" min="0.1" max="5" step="0.1" value={maxTrade} onChange={(e) => setMaxTrade(+e.target.value)} className="mt-2 w-full accent-toxic" />
            </label>
            <label className="mt-4 block">
              <span className="flex justify-between font-mono text-[11px] uppercase text-dim"><span>Daily spend cap</span><span className="text-ink">{dailyCap} SOL</span></span>
              <input type="range" min="0.5" max="20" step="0.5" value={dailyCap} onChange={(e) => setDailyCap(+e.target.value)} className="mt-2 w-full accent-toxic" />
            </label>
            <button onClick={saveLimits} className="mt-5 w-full rounded-md bg-toxic py-2.5 font-bold text-white shadow-toxic transition hover:brightness-110">{savedLimits ? "✓ Saved" : "Save limits"}</button>
            <p className="mt-3 font-mono text-[11px] text-dim">Grant or revoke auto-trading access in the panel below.</p>
          </div>
          <AutoTrade />
          <SwapPanel />
        </div>
      </div>
    </>
  );
}
