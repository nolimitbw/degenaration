"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * What this deployment can actually do, delivered to every screen that implies trading.
 *
 * WHY THIS EXISTS
 *
 * The Rams audit scored honesty 0/3, and it was the only load-bearing zero. The finding was
 * not a wording problem. A funded user could open the builder, choose a source, set a budget,
 * review a summary quoting a 2.00% fee, press save, and reasonably conclude a bot was now
 * trading for them. In production at the time of the audit:
 *
 *   mainnet_execution_enabled = false      the master gate is off
 *   worker_leases              = 0         no worker has ever heartbeat
 *   trade_intents              = 0         nothing has ever been attempted
 *   platformFeeBps             = 0         while the interface said 2.00%
 *
 * The only thing standing between that user and the truth was a one-line banner at the top of
 * the page **with a dismiss button**. Dismiss it once and every screen afterwards reads as a
 * working product.
 *
 * So readiness stops being a banner and becomes a fact the interface carries. One fetch, one
 * context, and the surfaces that promise execution — the builder, the bot manager, the
 * portfolio — state the real position where the user is looking at the thing that will not
 * happen. It is not dismissible, because the condition is not transient.
 *
 * FAIL CLOSED. A failed probe reports "not trading", never "trading". Optimism here means
 * telling someone their money is working when it is idle.
 */

export type ReadinessCheck = { id: string; ok: boolean; reason: string };

export type Readiness = {
  /** Do bots place trades on their own, right now, on mainnet? */
  trading: boolean;
  /** Server's own one-line reason for the first failing check. */
  reason: string;
  /** Which of the eleven named checks failed first. */
  failedCheck: string | null;
  checks: ReadinessCheck[];
  /** The fee ACTUALLY charged. 0 when no fee token account resolves on chain. */
  feeBps: number;
  feeLabel: string;
  /** True once the probe has answered, so callers can avoid asserting during the gap. */
  known: boolean;
};

const UNKNOWN: Readiness = {
  trading: false,
  reason: "Checking whether automated trading is running.",
  failedCheck: null,
  checks: [],
  feeBps: 0,
  feeLabel: "None",
  known: false
};

const ReadinessContext = createContext<Readiness>(UNKNOWN);

export function ReadinessProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<Readiness>(UNKNOWN);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (cancelled || !config) return;
        setValue({
          trading: Boolean(config.automation?.live),
          reason: config.automation?.reason || "Automated trading is not running.",
          failedCheck: config.automation?.failedCheck ?? null,
          checks: Array.isArray(config.automation?.checks) ? config.automation.checks : [],
          feeBps: Number(config.platformFeeBps ?? 0),
          feeLabel: String(config.feeLabel ?? "None"),
          known: true
        });
      })
      // A probe that fails must not invent capability. It stays "not trading" and says why.
      .catch(() => {
        if (!cancelled) setValue({ ...UNKNOWN, known: true, reason: "Could not reach the service to check whether trading is running." });
      });
    return () => { cancelled = true; };
  }, []);

  return <ReadinessContext.Provider value={value}>{children}</ReadinessContext.Provider>;
}

export function useReadiness() {
  return useContext(ReadinessContext);
}

/**
 * The honest state of one bot, stated where the bot is.
 *
 * Rendered inside the builder's review panel and on every row of the manager. It is a
 * statement of fact, not an alert: no icon, no colour flood, no dismiss. When trading is
 * live it renders nothing at all — a notice that is always present is furniture, and people
 * stop reading furniture.
 */
export function TradingNotice({ compact = false }: { compact?: boolean }) {
  const { trading, reason, known } = useReadiness();
  if (!known || trading) return null;
  return (
    <p
      className={`border-l-2 border-gold-400/60 pl-3 text-dim ${compact ? "t-label leading-5" : "t-meta leading-5"}`}
      role="status"
    >
      <span className="font-medium text-ink">This bot will save, but it will not trade yet.</span>{" "}
      {reason} Your funds stay in your own wallet.
    </p>
  );
}

/**
 * The fee actually charged, for use anywhere the interface quotes a rate.
 *
 * Never renders the configured rate. If the platform is not collecting, it says so, because
 * quoting 2.00% while charging nothing is the specific misstatement this replaced.
 */
export function FeeLabel() {
  const { feeBps, feeLabel, known } = useReadiness();
  if (!known) return <span className="ui-absent">—</span>;
  if (feeBps <= 0) return <span title="No platform fee is being collected on this deployment.">No platform fee</span>;
  return <span>{feeLabel} platform fee</span>;
}
