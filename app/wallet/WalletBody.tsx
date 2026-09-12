"use client";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { getNet } from "@/lib/net";
import { usePrivy } from "@privy-io/react-auth";
import { fetchBalance } from "@/lib/queries";
import { useToast } from "@/components/Toast";
import { getSolanaAddress } from "@/lib/solanaWallet";

// Privy-dependent funding hub. Bot-level limits and execution controls live in the builders.
export default function WalletBody() {
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const toast = useToast();
  const address = getSolanaAddress(user);

  const [copied, setCopied] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

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
  if (!authenticated || !address) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-edge bg-panel p-8 text-center">
        <h1 className="t-title font-bold">Connect your wallet</h1>
        <p className="mt-2 t-body text-dim">Sign in to create a Privy-secured Solana wallet or connect a supported wallet.</p>
        <button onClick={login} className="mt-6 w-full rounded-md bg-gold-400 py-3 font-bold text-[#17110c] shadow-gold transition hover:brightness-110">Connect wallet</button>
        <p className="mt-3 t-label text-dim">Wallet keys remain with your wallet provider.</p>
      </div>
    );
  }

  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&bgcolor=08090c&color=22e07a&data=${address}`;

  return (
    <>
      <h1 className="t-display font-bold">Wallet</h1>
      <p className="mt-1 t-body text-dim">Fund the wallet your bots use for automated trades.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="gradient-border rounded-lg border border-edge p-5">
          <h2 className="font-bold">Deposit SOL </h2>
          <div className="mt-4 flex flex-col items-center gap-4">
            <img src={qr} alt="deposit QR" className="rounded-md border border-edge bg-void" width={180} height={180} />
            <div className="w-full">
              <p className="ui-label">Your deposit address</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border border-edge bg-void px-3 py-2 font-mono t-label">{address}</code>
                <button onClick={copy} className="rounded-md bg-gold-400 px-3 py-2 t-label font-bold text-white">{copied ? <Check size={14} aria-label="Copied" /> : "Copy"}</button>
              </div>
            </div>
            <p className="w-full rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-center t-label text-danger">Send only mainnet SOL. Transfers are irreversible.</p>
          </div>
        </div>

        <div className="gradient-border h-fit rounded-lg border border-edge p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="t-label uppercase text-dim">Balance</p>
                <p className="mt-1 font-mono t-display font-bold">{balanceLoading ? "…" : balance != null ? balance.toFixed(3) : "—"} <span className="t-section text-dim">SOL</span></p>
                <p className="mt-1 font-mono t-label text-dim">{balanceError ? balanceError : "mainnet"}</p>
              </div>
              <button onClick={loadBalance} disabled={balanceLoading}
                className="rounded-md border border-edge px-3 py-1.5 t-label font-bold text-dim transition hover:border-gold-400 hover:text-gold-400 disabled:opacity-50">
                {balanceLoading ? "Checking" : "Refresh"}
              </button>
            </div>
        </div>
      </div>
    </>
  );
}
