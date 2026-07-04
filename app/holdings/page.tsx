"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy-dependent body loads as a separate client chunk.
const HoldingsBody = dynamic(() => import("./HoldingsBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading holdings…</p>
});

export default function Holdings() {
  return (
    <AppShell>
      <HoldingsBody />
    </AppShell>
  );
}
