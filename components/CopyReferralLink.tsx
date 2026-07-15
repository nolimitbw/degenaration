"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export default function CopyReferralLink({ path }: { path: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  const Icon = state === "copied" ? Check : Copy;
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-edge bg-void px-4 text-sm font-semibold text-ink transition hover:border-toxic/60 hover:text-toxic"
    >
      <Icon aria-hidden="true" size={16} />
      {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy referral link"}
    </button>
  );
}
