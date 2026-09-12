"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLinkAccount, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import { Copy, ExternalLink, Loader2, LogOut, Wallet, WalletCards } from "lucide-react";
import { useToast } from "@/components/Toast";
import { getSolanaAddress } from "@/lib/solanaWallet";

function getAccountEmail(user: any) {
  return (
    user?.google?.email ||
    user?.email?.address ||
    user?.linkedAccounts?.find((account: any) => account.type === "google_oauth")?.email ||
    ""
  );
}

export default function WalletButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { linkWallet } = useLinkAccount();
  const { createWallet } = useCreateWallet();
  const toast = useToast();
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"create" | "logout" | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!ready) {
    return <span className="h-10 w-28 animate-pulse rounded-md border border-edge bg-panel" aria-label="Loading account" />;
  }

  if (!authenticated) {
    return (
      <button
        type="button"
        onClick={login}
        className="inline-flex min-h-11 sm:min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-gold-400 px-3 t-label font-semibold text-[#17110c] transition hover:brightness-110"
      >
        <Wallet aria-hidden="true" size={14} />
        Connect wallet
      </button>
    );
  }

  const address = getSolanaAddress(user);
  const short = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "Set up wallet";
  const email = getAccountEmail(user);

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard?.writeText(address);
    toast("Wallet address copied");
  }

  async function createSolanaWallet() {
    setBusy("create");
    try {
      await createWallet();
      toast("Solana wallet created");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not create Solana wallet", "err");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setBusy("logout");
    try {
      await logout();
      setOpen(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex min-h-11 sm:min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-gold-400/55 px-3 font-mono t-label text-gold-400 transition hover:border-gold-400 hover:bg-gold-400/5"
      >
        <Wallet aria-hidden="true" size={14} />
        {short}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-12 z-50 w-[min(88vw,320px)] overflow-hidden rounded-md border border-edge bg-panel shadow-2xl">
          <div className="border-b border-edge px-4 py-3">
            <p className="t-label font-semibold text-ink">Wallet account</p>
            {email && <p className="mt-1 truncate t-label text-dim">{email}</p>}
          </div>

          {address ? (
            <div className="border-b border-edge p-3">
              <p className="field-label">Solana wallet</p>
              <button
                type="button"
                onClick={copyAddress}
                className="mt-2 flex min-h-11 sm:min-h-11 sm:min-h-10 w-full items-center justify-between gap-3 rounded-md border border-edge bg-void px-3 text-left"
              >
                <span className="truncate ui-code t-label text-ink">{address}</span>
                <Copy aria-hidden="true" size={14} className="shrink-0 text-dim" />
              </button>
            </div>
          ) : (
            <div className="border-b border-edge p-3">
              <p className="t-label font-medium text-ink">No Solana wallet linked</p>
              <p className="mt-1 t-label leading-4 text-dim">Create a secured embedded wallet or link an existing Solana wallet.</p>
              <button
                type="button"
                onClick={createSolanaWallet}
                disabled={busy === "create"}
                className="mt-3 inline-flex min-h-11 sm:min-h-11 sm:min-h-10 w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-3 t-label font-semibold text-[#17110c] disabled:opacity-50"
              >
                {busy === "create" ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <Wallet aria-hidden="true" size={14} />}
                Create Solana wallet
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  linkWallet({ walletChainType: "solana-only" });
                }}
                className="mt-2 inline-flex min-h-11 sm:min-h-11 sm:min-h-10 w-full items-center justify-center gap-2 rounded-md border border-edge px-3 t-label font-semibold text-ink"
              >
                <ExternalLink aria-hidden="true" size={14} />
                Link existing wallet
              </button>
            </div>
          )}

          <div className="p-2">
            <Link
              href="/portfolio"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 sm:min-h-11 sm:min-h-10 items-center gap-3 rounded-md px-3 t-label font-medium text-ink transition hover:bg-void"
            >
              <WalletCards aria-hidden="true" size={15} className="text-dim" />
              Open portfolio
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={busy === "logout"}
              className="mt-1 flex min-h-11 sm:min-h-11 sm:min-h-10 w-full items-center gap-3 rounded-md border-t border-edge px-3 text-left t-label font-medium text-down transition hover:bg-down/5 disabled:opacity-50"
            >
              {busy === "logout" ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <LogOut aria-hidden="true" size={15} />}
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
