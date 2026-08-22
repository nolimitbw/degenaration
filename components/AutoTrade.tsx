"use client";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { usePrivy, useHeadlessDelegatedActions } from "@privy-io/react-auth";
import { useToast } from "@/components/Toast";
import { getSolanaAddress } from "@/lib/solanaWallet";
import { useAutomationStatus } from "@/lib/useAutomationStatus";

/**
 * 24/7 auto-trading opt-in. Grants Privy a DELEGATED session key for the user's embedded
 * Solana wallet so the server worker can request signatures while the user is offline.
 * Application controls are enforced by the worker and database, not by the delegation itself.
 */
export default function AutoTrade({ headless = false }: { headless?: boolean } = {}) {
  const { user, authenticated } = usePrivy();
  // This component provides its own explicit consent UI, so use Privy's headless action
  // instead of waiting for a second provider modal that may be disabled in the dashboard.
  const { delegateWallet, revokeWallets } = useHeadlessDelegatedActions();
  const toast = useToast();
  const automation = useAutomationStatus();
  const [busy, setBusy] = useState(false);

  const address = getSolanaAddress(user);
  const delegated = ((user as any)?.linkedAccounts || []).some(
    (a: any) => a.type === "wallet" && a.chainType === "solana" && a.delegated
  );

  // Ask ONCE per wallet, automatically, instead of leaving it as a control to find.
  //
  // Privy will not let the server sign for a wallet until its owner has delegated to the app's
  // authorization key, and that consent is deliberately the user's to give — it cannot be set
  // from our side for a wallet that already exists. What we can remove is the hunting: prompt
  // on arrival so the user only has to approve.
  //
  // Once per address, remembered across reloads, because re-opening a wallet dialog on every
  // page view is worse than the problem it solves. Declining leaves the card below to do it
  // later.
  const prompted = useRef(false);
  useEffect(() => {
    if (!headless) return; // the visible card must never disable its own button
    if (!authenticated || !address || delegated || busy || prompted.current) return;
    const seenKey = `degen.delegate.asked.${address}`;
    try { if (window.localStorage.getItem(seenKey)) return; } catch { /* private mode */ }
    prompted.current = true;
    // Mark it asked only AFTER the prompt actually ran. Setting it first meant a throw before
    // Privy's dialog appeared — not ready yet, no embedded wallet yet — burned the single
    // attempt, and the user was never asked again on any page. That is the whole feature
    // failing silently, which is the failure mode this session has hit too many times.
    void enable()
      .then(() => { try { window.localStorage.setItem(seenKey, "1"); } catch { /* private mode */ } })
      .catch(() => { prompted.current = false; });
  }, [authenticated, address, delegated, busy]);

  if (!authenticated || !address) return null;
  // Mounted app-wide purely to run the prompt above; the card itself belongs on /wallet.
  if (headless) return null;

  async function enable() {
    setBusy(true);
    try {
      // delegateWallet can sit unresolved when Privy's dialog never opens — a popup blocked,
      // the SDK not ready, delegated actions not enabled on the app. Without a bound the
      // button stays "..." for ever and the user cannot retry, which is exactly how this
      // control appeared broken rather than merely unanswered.
      await Promise.race([
        delegateWallet({ address: address!, chainType: "solana" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Privy did not open the approval dialog. Check that delegated actions are enabled for this app, then try again.")), 20_000))
      ]);
      toast("Delegated access enabled. Review engine status and limits before activating orders.");
    }
    catch (e: any) { toast(e.message || "Could not enable delegated access", "err"); setBusy(false); throw e; }
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
        <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${delegated ? "bg-gold-400/20 text-gold-400" : "bg-edge text-dim"}`}>{delegated ? "GRANTED" : "OFF"}</span>
      </div>
      <p className="mt-1 text-xs text-dim">Lets your bots trade while you are offline. You can revoke it at any time.</p>

      {/* Progressive disclosure: the full explanation lives behind a control rather than
          as four sentences under the heading (spec 6.1, 6.3, 17.4). */}
      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-gold-400">
          <Info size={13} aria-hidden="true" />
          How automation access works
        </summary>
        <div className="mt-2 space-y-2 rounded-md border border-edge bg-void px-3 py-2.5 text-[11px] leading-5 text-dim">
          <p>Granting access lets the worker request a signature from your wallet without you being present. Your saved per-trade and daily caps are checked before any entry runs.</p>
          <p>This access is broad — it is not restricted to trading alone — so leave it off unless you need it, and revoke it when you are done.</p>
          <p>Your wallet key stays with Privy. DegenAration never stores it.</p>
        </div>
      </details>

      <p className={`mt-3 text-[12px] ${automation.live ? "text-up" : "text-dim"}`}>
        {delegated ? "Auto-trading access is on" : automation.loading ? "Checking auto-trading" : "Ready to enable auto-trading"}
      </p>
      {delegated ? (
        <button onClick={disable} disabled={busy} className="mt-4 w-full rounded-md border border-danger/50 py-2.5 text-sm font-bold text-danger transition hover:bg-danger/10 disabled:opacity-50">{busy ? "…" : "Revoke delegated access"}</button>
      ) : (
        <button onClick={enable} disabled={busy} className="mt-4 w-full rounded-md bg-gold-400 py-2.5 font-bold text-[#17110c] shadow-gold transition hover:brightness-110 disabled:opacity-50">{busy ? "…" : "Grant delegated access"}</button>
      )}
    </div>
  );
}
