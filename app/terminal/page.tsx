"use client";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import dynamic from "next/dynamic";

// Shell paints instantly; the Privy + trade-execution body loads as a separate chunk.
const TerminalBody = dynamic(() => import("./TerminalBody"), {
  ssr: false,
  loading: () => <p className="text-sm text-dim">Loading terminal…</p>
});

export default function Terminal() {
  return (
    <AppShell>
      <Suspense fallback={<p className="text-sm text-dim">Loading terminal…</p>}>
        <TerminalBody />
      </Suspense>
    </AppShell>
  );
}
