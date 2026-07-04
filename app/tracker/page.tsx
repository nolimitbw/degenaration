"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy-dependent body loads as a separate client chunk.
const TrackerBody = dynamic(() => import("./TrackerBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading tracker…</p>
});

export default function Tracker() {
  return (
    <AppShell>
      <TrackerBody />
    </AppShell>
  );
}
