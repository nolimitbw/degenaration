"use client";
import { useState } from "react";
import { usePrivy, useDelegatedActions } from "@privy-io/react-auth";
import { useToast } from "@/components/Toast";
import { getSolanaAddress } from "@/lib/solanaWallet";
import { automationLabel, useAutomationStatus } from "@/lib/useAutomationStatus";

/**
 * 24/7 auto-trading opt-in. Grants Privy a DELEGATED session key for the user's embedded
 * Solana wallet so the server worker can request signatures while the user is offline.
 * Application controls are enforced by the worker and database, not by the delegation itself.
 */
export default function AutoTrade() {
  const { user, authenticated } = usePrivy();
  const { delegateWallet, revokeWallets } = useDelegatedActions();
  const toast = useToast();
  const automation = useAutomationStatus();
  const [busy, setBusy] = useState(false);

  const address = getSolanaAddress(user);
  const delegated = ((user as any)?.linkedAccounts || []).some(
    (a: any) => a.type === "wallet" && a.chainType === "solana" && a.delegated
  );

  if (!authenticated || !address) return null;

  async function enable() {
    setBusy(true);
    try { await delegateWallet({ address: address!, chainType: "solana" }); toast("Delegated access enabled. Review engine status and limits before activating orders."); }
    catch (e: any) { toast(e.message || "Could not enable delegated access", "err"); }
    setBusy(false);
  }
  async function disable() {
    setBusy(true);
    try { await revokeWallets(); toast("Delegated access revoked"); }
    catch (e: any) { toast(e.message || "Could not revoke", "err"); }
    setBusy(false);
  }

  return (
    <div className="gradient-border rounded-lg border border-edge p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Delegated automation access</h2>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${delegated ? "bg-toxic/20 text-toxic" : "bg-edge text-dim"}`}>{delegated ? "GRANTED" : "OFF"}</span>
      </div>
      <p className="mt-1 text-xs text-dim">
        Delegation lets the configured worker request wallet signatures while you are offline.
        Degenaration checks saved per-trade and daily limits atomically before it claims supported automation work.
        The underlying delegation is powerful and is not itself a trade-only policy, so keep it off unless needed and revoke it anytime.
        Privy secures the wallet key; Degenaration does not store it.
      </p>
      <p className={`mt-3 font-mono text-[10px] ${automation.live ? "text-up" : "text-dim"}`}>Engine: {automationLabel(automation)}</p>
      {delegated ? (
        <button onClick={disable} disabled={busy} className="mt-4 w-full rounded-md border border-hotpink/50 py-2.5 text-sm font-bold text-hotpink transition hover:bg-hotpink/10 disabled:opacity-50">{busy ? "…" : "Revoke delegated access"}</button>
      ) : (
        <button onClick={enable} disabled={busy} className="mt-4 w-full rounded-md bg-toxic py-2.5 font-bold text-[#17110c] shadow-toxic transition hover:brightness-110 disabled:opacity-50">{busy ? "…" : "Grant delegated access"}</button>
      )}
    </div>
  );
}
