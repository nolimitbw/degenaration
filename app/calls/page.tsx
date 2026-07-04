"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy-aware body loads as a separate client chunk.
const CallsBody = dynamic(() => import("./CallsBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading call groups…</p>
});

export default function Calls() {
  return (
    <AppShell>
      <CallsBody />
    </AppShell>
  );
}
