"use client";

import { useState } from "react";
import { Copy, ExternalLink, LogIn, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { getSolanaAddress, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";

export default function SettingsBody() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const wallet = getSolanaAddress(user);
  const delegated = hasDelegatedSolanaWallet(user);
  const linked = ((user as any)?.linkedAccounts ?? []) as Array<any>;
  const email = (user as any)?.email?.address
    ?? linked.find((account) => account?.type === "email")?.address
    ?? null;
  const joined = (user as any)?.createdAt
    ? new Date((user as any).createdAt).toLocaleDateString()
    : null;

  async function copyWallet() {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try { await logout(); } finally { setBusy(false); }
  }

  if (!authenticated) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-edge bg-panel p-8 text-center">
        <ShieldCheck size={28} className="mx-auto text-toxic" />
        <h1 className="mt-4 text-xl font-bold">Account settings</h1>
        <p className="mt-2 text-sm text-dim">Sign in through Privy to review your account, wallet, and delegation state.</p>
        <button onClick={login} disabled={!ready} className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-toxic px-4 font-bold text-[#17110c] disabled:opacity-50"><LogIn size={17} /> Sign in</button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Account settings</h1><p className="mt-1 text-sm text-dim">Privy identity, linked accounts, and wallet access state.</p></div>
        <span className="rounded-md border border-edge bg-void px-3 py-2 font-mono text-[10px] uppercase text-dim">Privy session active</span>
      </div>

      <div className="mt-6 grid max-w-5xl gap-5 lg:grid-cols-2">
        <section className="rounded-lg border border-edge bg-panel p-5">
          <div className="flex items-center gap-2"><ShieldCheck size={17} className="text-toxic" /><h2 className="font-bold">Identity</h2></div>
          <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2">
            <div className="bg-void p-3"><dt className="font-mono text-[9px] uppercase text-dim">Email</dt><dd className="mt-1 truncate text-sm">{email ?? "Not linked"}</dd></div>
            <div className="bg-void p-3"><dt className="font-mono text-[9px] uppercase text-dim">Joined</dt><dd className="mt-1 text-sm">{joined ?? "Unavailable"}</dd></div>
            <div className="bg-void p-3"><dt className="font-mono text-[9px] uppercase text-dim">Privy user</dt><dd className="mt-1 truncate font-mono text-xs">{user?.id ?? "Unavailable"}</dd></div>
            <div className="bg-void p-3"><dt className="font-mono text-[9px] uppercase text-dim">Linked accounts</dt><dd className="mt-1 text-sm">{linked.length}</dd></div>
          </dl>
        </section>

        <section className="rounded-lg border border-edge bg-panel p-5">
          <div className="flex items-center gap-2"><WalletCards size={17} className="text-toxic" /><h2 className="font-bold">Solana wallet</h2></div>
          <p className="mt-1 text-xs text-dim">The key is secured by your wallet provider. Delegated access is managed separately in Wallet.</p>
          {wallet ? (
            <div className="mt-4">
              <code className="block truncate rounded-md border border-edge bg-void px-3 py-2.5 font-mono text-xs">{wallet}</code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={copyWallet} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-bold transition hover:border-toxic"><Copy size={14} /> {copied ? "Copied" : "Copy"}</button>
                <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-bold transition hover:border-toxic"><ExternalLink size={14} /> Solscan</a>
                <span className={`inline-flex min-h-10 items-center rounded-md border px-3 font-mono text-[10px] uppercase ${delegated ? "border-toxic/40 text-toxic" : "border-edge text-dim"}`}>Delegation {delegated ? "granted" : "off"}</span>
              </div>
            </div>
          ) : <p className="mt-4 rounded-md border border-edge bg-void p-4 text-sm text-dim">No Solana wallet is linked to this Privy account.</p>}
        </section>

        <section className="rounded-lg border border-edge bg-panel p-5 lg:col-span-2">
          <h2 className="font-bold">Session</h2>
          <p className="mt-1 text-xs text-dim">Sign out of this browser. Revoke delegated wallet access separately from the Wallet screen before signing out when you no longer need unattended execution.</p>
          <button onClick={signOut} disabled={busy} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-hotpink/50 px-4 text-sm font-bold text-hotpink transition hover:bg-hotpink/10 disabled:opacity-50"><LogOut size={16} /> {busy ? "Signing out" : "Sign out"}</button>
        </section>
      </div>
    </>
  );
}
