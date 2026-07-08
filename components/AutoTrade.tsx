"use client";
import { useState } from "react";
import { usePrivy, useDelegatedActions } from "@privy-io/react-auth";
import { useToast } from "@/components/Toast";
import { getSolanaAddress } from "@/lib/solanaWallet";

/**
 * 24/7 auto-trading opt-in. Grants Privy a DELEGATED session key for the user's embedded
 * Solana wallet so the server worker can execute limit orders / copy trades while the user
 * is offline. Trade-only + spend-capped (Wallet limits) + revocable. Keys never leave Privy.
 */
export default function AutoTrade() {
  const { user, authenticated } = usePrivy();
  const { delegateWallet, revokeWallets } = useDelegatedActions();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const address = getSolanaAddress(user);
  const delegated = ((user as any)?.linkedAccounts || []).some(
    (a: any) => a.type === "wallet" && a.chainType === "solana" && a.delegated
  );

  if (!authenticated || !address) return null;

  async function enable() {
    setBusy(true);
    try { await delegateWallet({ address: address!, chainType: "solana" }); toast("Auto-trading enabled — trade-only, capped, revocable"); }
    catch (e: any) { toast(e.message || "Could not enable auto-trading", "err"); }
    setBusy(false);
  }
  async function disable() {
    setBusy(true);
    try { await revokeWallets(); toast("Auto-trading permission revoked"); }
    catch (e: any) { toast(e.message || "Could not revoke", "err"); }
    setBusy(false);
  }

  return (
    <div className="gradient-border rounded-lg border border-edge p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">24/7 Auto-trading</h2>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${delegated ? "bg-toxic/20 text-toxic" : "bg-edge text-dim"}`}>{delegated ? "ENABLED" : "OFF"}</span>
      </div>
      <p className="mt-1 text-xs text-dim">
        Let the engine run your limit orders and copy trades even while your device is off.
        Our engine only ever signs <b className="text-gray-900">Jupiter swaps within your spend caps</b>
        above, never a transfer out, and the grant is <b className="text-gray-900">revocable anytime</b>.
        Your keys stay in Privy — we never hold them.
      </p>
      {delegated ? (
        <button onClick={disable} disabled={busy} className="mt-4 w-full rounded-md border border-hotpink/50 py-2.5 text-sm font-bold text-hotpink transition hover:bg-hotpink/10 disabled:opacity-50">{busy ? "…" : "Revoke auto-trading"}</button>
      ) : (
        <button onClick={enable} disabled={busy} className="mt-4 w-full rounded-md bg-toxic py-2.5 font-bold text-white shadow-toxic transition hover:brightness-110 disabled:opacity-50">{busy ? "…" : "Enable auto-trading"}</button>
      )}
    </div>
  );
}
