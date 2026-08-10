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
    /*
     * Presentation, not content: the notice is about automation, and it opened with
     * "SOLANA MAINNET." in bold caps beside a pulsing dot. The loudest element on the page
     * was a word that is not the message, animated, above every screen. A restriction should
     * be legible and calm — it is information, not an alarm.
     */
    <div className="release-banner relative z-[80] border-b border-[color:var(--rule)] bg-[#141210]">
      <div className="mx-auto flex max-w-[1560px] items-center gap-2.5 px-4 py-2 lg:px-8">
        <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-gold-400" aria-hidden="true" />
        <p className="min-w-0 text-[12px] leading-5 text-[#b39c81]">{notice}</p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          title="Dismiss"
          className="ml-auto grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md text-[#8b7c6a] opacity-70 transition hover:opacity-100"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>
    </div>
  );
}
