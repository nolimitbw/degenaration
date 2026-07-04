"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy-dependent wallet hub loads as a separate client chunk.
const WalletBody = dynamic(() => import("./WalletBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading wallet…</p>
});

export default function Wallet() {
  return (
    <AppShell>
      <WalletBody />
    </AppShell>
  );
}
