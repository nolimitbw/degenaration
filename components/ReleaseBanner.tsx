"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { capabilitiesFrom, restrictionNotice } from "@/lib/capabilities";

/**
 * States what is restricted, and nothing else.
 *
 * This read: "SOLANA MAINNET. You confirm every transaction in your own wallet. Automated
 * trading and payouts are not yet available." — on every page, for every visitor.
 *
 * The payouts half was false. Withdrawals and affiliate payouts are implemented, deployed and
 * verified, and the Portfolio's Withdraw flow uses them. Telling people they cannot take their
 * money out is the most damaging thing a trading product can say untruthfully about itself,
 * and it was in the first line of every screen.
 *
 * The restriction now comes from the server's own automation state rather than a compiled-in
 * constant, so it disappears by itself once a worker is running. When nothing is restricted the
 * banner does not render at all — a notice that is always present is furniture, and furniture
 * is not read.
 */
export default function ReleaseBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((config) => { if (!cancelled) setNotice(restrictionNotice(capabilitiesFrom(config))); })
      // A failed probe must not invent a restriction. Say nothing rather than guess.
      .catch(() => { if (!cancelled) setNotice(null); });
    return () => { cancelled = true; };
  }, []);

  if (dismissed || !notice) return null;
  return (
    <div className="relative z-[80] flex items-center justify-center gap-2 border-b border-gold-400/20 bg-[#191613] px-4 py-2 text-center font-mono text-[11px] text-[#c9aa88]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-400" />
      </span>
      <span><b>SOLANA MAINNET.</b> {notice}</span>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" title="Dismiss" className="ml-1 grid min-h-11 min-w-11 place-items-center rounded-md opacity-70 transition hover:bg-gold-400/10 hover:opacity-100">
        <X aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
