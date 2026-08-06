"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { formatSol } from "@/lib/product-api";

/**
 * Platform revenue, owner-only.
 *
 * Loads independently of the twelve-request bulk load for the same reason `ClientLedger` does:
 * it is backed by its own RPC, and folding it in would make every other tab wait for it.
 *
 * Two presentation rules this panel exists to keep:
 *
 *   1. A fee on an unconfirmed execution is NOT revenue. It is shown, clearly separated, and is
 *      in no period total — because an operator withdrawing against a number that includes
 *      trades which have not landed would be withdrawing money the platform has not earned.
 *   2. `allocationDrift` is shown before any total when it is non-zero. Every other figure on
 *      this page depends on the ledger agreeing with itself; showing them first would be
 *      presenting numbers we have just been told not to trust.
 */

type Revenue = {
  ok?: boolean;
  unit?: string;
  platformFee?: { today?: string; d7?: string; d30?: string; lifetime?: string };
  confirmedExecutions?: number;
  confirmedVolumeLamports?: string;
  pendingFeeLamports?: string;
  pendingExecutions?: number;
  creatorAllocatedLamports?: string;
  referralAllocatedLamports?: string;
  netRevenueLamports?: string;
  creatorPayoutsPaidLamports?: string;
  creatorPayoutsInFlightLamports?: string;
  failedCreatorPayouts?: number;
  availableLamports?: string;
  revenueWithdrawalLedger?: string;
  allocationDrift?: string;
  reconciled?: boolean;
};

type FeeAccount = {
  configured?: boolean;
  ready?: boolean;
  mints?: Array<{ symbol?: string; mint?: string; derivedAccount?: string | null; ready?: boolean; reason?: string | null }>;
};

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "up" | "down" | "dim" }) {
  const colour = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <div className="rounded-md border border-edge bg-panel p-4">
      <p className="font-mono text-[9px] uppercase tracking-wide text-dim">{label}</p>
      <p className={`mt-2 text-lg font-semibold tabular-nums ${colour}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-4 text-dim">{hint}</p>}
    </div>
  );
}

export default function RevenuePanel({
  fetchJson,
  feeAccount
}: {
  fetchJson: <T>(path: string) => Promise<T>;
  feeAccount?: FeeAccount;
}) {
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ revenue: Revenue }>(`/api/admin/revenue?t=${Date.now()}`);
      setRevenue(data.revenue || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revenue could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => { load(); }, [load]);

  if (loading && !revenue) {
    return <p className="rounded-md border border-edge bg-panel p-6 text-xs text-dim">Loading confirmed revenue…</p>;
  }
  if (error) {
    return (
      <div className="rounded-md border border-down/35 bg-down/5 p-5">
        <p className="text-xs font-semibold text-down">Revenue could not be loaded</p>
        <p className="mt-1 font-mono text-[10px] text-down">{error}</p>
        <button type="button" onClick={load} className="mt-3 min-h-11 rounded-md border border-edge px-3 text-xs font-semibold text-dim hover:text-ink">
          Try again
        </button>
      </div>
    );
  }
  if (!revenue) return null;

  const fee = revenue.platformFee || {};
  const drift = revenue.allocationDrift || "0";
  const collecting = feeAccount?.ready === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Platform revenue</h2>
          <p className="mt-1 text-xs text-dim">
            Confirmed executions only. Fees are collected in the swap output mint; totals below are the ledger&apos;s own lamport figures and no exchange rate is applied.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-dim hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Shown BEFORE any total. If the ledger does not agree with itself, every figure below
          it is suspect and presenting them first would imply a confidence we do not have. */}
      {revenue.reconciled === false && (
        <div className="rounded-md border border-down/40 bg-down/5 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-down">
            <AlertTriangle size={14} /> Reconciliation warning
          </p>
          <p className="mt-2 text-xs leading-5 text-down">
            Creator, referral and retained allocations do not sum to the platform fee collected. Difference: {formatSol(drift)} ({drift} lamports).
            Do not treat the available figure as withdrawable until this is explained.
          </p>
        </div>
      )}

      {!collecting && (
        <p className="rounded-md border border-gold-400/35 bg-gold-400/5 px-4 py-3 text-xs leading-5 text-gold-400">
          The fee token account is not ready, so confirmed swaps are currently charging 0 bps. Revenue below is what the ledger holds, not what the fee rate implies. See the System tab for the exact account to create.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Fees today" value={formatSol(fee.today)} />
        <Figure label="Fees 7D" value={formatSol(fee.d7)} />
        <Figure label="Fees 30D" value={formatSol(fee.d30)} />
        <Figure label="Fees lifetime" value={formatSol(fee.lifetime)} hint={`${revenue.confirmedExecutions ?? 0} confirmed executions`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Pending, not yet revenue"
          value={formatSol(revenue.pendingFeeLamports)}
          tone="dim"
          hint={`${revenue.pendingExecutions ?? 0} submitted and unconfirmed. Excluded from every total above.`}
        />
        <Figure label="Creator allocated" value={formatSol(revenue.creatorAllocatedLamports)} tone="dim" hint="Owed to Discord and KOL creators." />
        <Figure label="Referral allocated" value={formatSol(revenue.referralAllocatedLamports)} tone="dim" hint="Owed to referrers, funded from the platform fee." />
        <Figure label="Confirmed volume" value={formatSol(revenue.confirmedVolumeLamports)} tone="dim" hint="Executed notional the fee was charged on." />
      </div>

      <div className="rounded-md border border-edge bg-panel p-5">
        <p className="font-mono text-[9px] uppercase tracking-wide text-gold-400">DegenAration retained</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{formatSol(revenue.netRevenueLamports)}</p>
        <p className="mt-2 text-xs leading-5 text-dim">
          Platform fee minus the creator and referral allocations. Creator payouts are not subtracted here — that allocation was already removed once, and removing it twice would understate revenue by the same amount every time.
        </p>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-dim">Available</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{formatSol(revenue.availableLamports)}</dd>
          </div>
          <div>
            <dt className="text-dim">Allocation drift</dt>
            <dd className={`mt-1 font-semibold tabular-nums ${revenue.reconciled === false ? "text-down" : "text-up"}`}>
              {drift === "0" ? "0 — reconciled" : `${drift} lamports`}
            </dd>
          </div>
          <div>
            <dt className="text-dim">Network fee reserve</dt>
            <dd className="mt-1 tabular-nums text-dim">Paid per transaction from the fee account, not held here</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-md border border-edge bg-panel p-5">
        <p className="text-xs font-semibold text-ink">Creator payouts</p>
        <p className="mt-1 text-xs leading-5 text-dim">
          The affiliate ledger, shown beside revenue so the two are visibly separate. This is money owed to creators and referrers, never DegenAration&apos;s.
        </p>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-dim">Paid and confirmed</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{formatSol(revenue.creatorPayoutsPaidLamports)}</dd>
          </div>
          <div>
            <dt className="text-dim">In flight</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{formatSol(revenue.creatorPayoutsInFlightLamports)}</dd>
          </div>
          <div>
            <dt className="text-dim">Failed or reversed</dt>
            <dd className={`mt-1 font-semibold tabular-nums ${(revenue.failedCreatorPayouts ?? 0) > 0 ? "text-down" : "text-ink"}`}>
              {revenue.failedCreatorPayouts ?? 0}
            </dd>
          </div>
        </dl>
      </div>

      {/* Withdraw fees. Deliberately not a working button yet, and deliberately not hidden.
          Rendering a control that opens a flow with no ledger behind it is the exact defect
          class this project keeps finding: a control that persists and changes nothing. */}
      <div className="rounded-md border border-edge bg-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-xs font-semibold text-ink">Withdraw fees</p>
            <p className="mt-1 text-xs leading-5 text-dim">
              {revenue.revenueWithdrawalLedger === "not-implemented"
                ? "Unavailable: no revenue-withdrawal ledger exists yet, so a withdrawal could not be recorded, made idempotent, or reconciled. It is also 0 bps collected today — there is no confirmed platform revenue to move."
                : "Withdraws confirmed platform revenue only. Never client principal, locked capital, creator rewards, or referral rewards."}
            </p>
          </div>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="No revenue-withdrawal ledger exists yet"
            className="min-h-11 rounded-md border border-edge px-4 text-xs font-semibold text-dim opacity-50"
          >
            Withdraw fees
          </button>
        </div>
      </div>
    </div>
  );
}
