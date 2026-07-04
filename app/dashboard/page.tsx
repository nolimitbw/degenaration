"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy-dependent body loads as a separate client chunk.
const DashboardBody = dynamic(() => import("./DashboardBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading portfolio…</p>
});

export default function Dashboard() {
  return (
    <AppShell>
      <DashboardBody />
    </AppShell>
  );
}
