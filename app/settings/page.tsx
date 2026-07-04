"use client";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy-aware body loads as a separate client chunk.
const SettingsBody = dynamic(() => import("./SettingsBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading settings…</p>
});

export default function Settings() {
  return (
    <AppShell>
      <SettingsBody />
    </AppShell>
  );
}
