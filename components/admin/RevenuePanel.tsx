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

      <WithdrawFees
        available={revenue.availableLamports || "0"}
        reconciled={revenue.reconciled !== false}
        fetchJson={fetchJson}
        onDone={load}
      />
    </div>
  );
}

/**
 * `Withdraw fees`.
 *
 * The server decides everything that matters — the available bound is recomputed inside
 * `admin_open_revenue_withdrawal` under a lock, so this component's `available` is for display
 * and the button being enabled is never the thing that prevents an overdraw.
 *
 * Signing is NOT here and is not coming. Platform revenue leaves the fee account under an
 * owner-held key; the flow is open → the owner signs and submits → paste the signature →
 * confirm. That is why the second step asks for a signature instead of offering a Sign button.
 */
function WithdrawFees({ available, reconciled, fetchJson, onDone }: {
  available: string;
  reconciled: boolean;
  fetchJson: <T>(path: string) => Promise<T>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<{ id: string; state: string } | null>(null);
  const [signature, setSignature] = useState("");

  // tsconfig targets es2017, so `0n` literals are unavailable. BigInt() calls are the same
  // values; the arithmetic below stays integer either way, which is the part that matters.
  const ZERO = BigInt(0);
  const LAMPORTS = BigInt(1_000_000_000);
  const availableLamports = (() => { try { return BigInt(available); } catch { return ZERO; } })();
  // Parsed from the typed SOL figure to an integer with no float multiplication: the string is
  // padded to nine decimal places and concatenated, so 1.000000001 SOL is exactly 1000000001
  // lamports rather than whatever the binary representation rounds to.
  const amountLamports = (() => {
    const match = /^(\d+)(?:\.(\d{0,9}))?$/.exec(amountSol.trim());
    if (!match) return null;
    try {
      const whole = BigInt(match[1]);
      const frac = BigInt((match[2] || "").padEnd(9, "0"));
      const total = whole * LAMPORTS + frac;
      return total > ZERO ? total : null;
    } catch { return null; }
  })();

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/revenue/withdraw", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `request failed (${response.status})`);
      return data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const tooMuch = amountLamports !== null && amountLamports > availableLamports;
  const remaining = amountLamports !== null && !tooMuch ? availableLamports - amountLamports : null;

  return (
    <div className="rounded-md border border-edge bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-xs font-semibold text-ink">Withdraw fees</p>
          <p className="mt-1 text-xs leading-5 text-dim">
            Moves DegenAration&apos;s retained share only. It cannot reach client principal, locked capital, creator rewards or referral rewards — the amount is bounded by the retained total, from which those allocations were already subtracted.
          </p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={availableLamports === ZERO || !reconciled}
            title={
              !reconciled ? "Resolve the reconciliation warning first"
                : availableLamports === ZERO ? "No confirmed platform revenue to withdraw"
                : undefined
            }
            className="min-h-11 rounded-md border border-gold-400/50 px-4 text-xs font-semibold text-gold-400 disabled:opacity-50"
          >
            Withdraw fees
          </button>
        )}
      </div>

      {/* Disabled for a REASON, stated. An operator who cannot press the button needs to know
          whether that is a bug, a permission, or simply an empty ledger. */}
      {!open && availableLamports === ZERO && (
        <p className="mt-3 text-[11px] text-dim">Nothing to withdraw: no confirmed platform fee has been collected yet.</p>
      )}
      {!open && !reconciled && availableLamports > ZERO && (
        <p className="mt-3 text-[11px] text-down">Withdrawal is held while the allocations do not sum to the fee collected.</p>
      )}

      {open && !intent && (
        <div className="mt-4 space-y-3 border-t border-edge pt-4">
          <label className="block">
            <span className="field-label">Destination wallet</span>
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Solana address"
              className="field-control mt-1.5 px-3 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="field-label">Amount</span>
            <input
              value={amountSol}
              onChange={(event) => setAmountSol(event.target.value)}
              inputMode="decimal"
              placeholder="0.000"
              className="field-control mt-1.5 px-3 font-mono text-xs"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAmountSol((Number(availableLamports) / 1e9).toFixed(9).replace(/0+$/, "").replace(/\.$/, ""))}
              className="min-h-11 rounded-md border border-edge px-3 font-mono text-[11px] text-dim hover:text-ink"
            >
              Max {formatSol(available)}
            </button>
          </div>
          <dl className="grid gap-2 rounded-md border border-edge bg-void p-3 text-[11px] sm:grid-cols-3">
            <div><dt className="text-dim">Available</dt><dd className="mt-0.5 tabular-nums text-ink">{formatSol(available)}</dd></div>
            <div><dt className="text-dim">Network fee</dt><dd className="mt-0.5 text-dim">Paid by the signing wallet, not deducted here</dd></div>
            <div>
              <dt className="text-dim">Balance after</dt>
              <dd className={`mt-0.5 tabular-nums ${tooMuch ? "text-down" : "text-ink"}`}>
                {tooMuch ? "Exceeds available" : remaining === null ? "—" : formatSol(remaining.toString())}
              </dd>
            </div>
          </dl>
          {error && <p role="alert" className="rounded-md border border-down/35 bg-down/5 px-3 py-2 text-[11px] text-down">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !destination.trim() || amountLamports === null || tooMuch}
              onClick={async () => {
                const data = await post({
                  action: "open",
                  mint: "So11111111111111111111111111111111111111112",
                  destination: destination.trim(),
                  amountBaseUnits: amountLamports?.toString()
                });
                if (data?.id) setIntent({ id: data.id, state: data.state });
              }}
              className="min-h-11 rounded-md bg-gold-400 px-4 text-xs font-semibold text-[#17110c] disabled:opacity-50"
            >
              {busy ? "Authorising…" : "Authorise withdrawal"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setError(null); }} className="min-h-11 rounded-md border border-edge px-4 text-xs font-semibold text-dim">
              Cancel
            </button>
          </div>
        </div>
      )}

      {intent && (
        <div className="mt-4 space-y-3 border-t border-edge pt-4">
          <p className="text-[11px] leading-5 text-dim">
            Withdrawal <span className="font-mono text-ink">{intent.id.slice(0, 8)}</span> is authorised and its amount is committed against the available balance. Sign and submit the transfer with the fee-account key, then record the signature here so it can be confirmed and reconciled.
          </p>
          <label className="block">
            <span className="field-label">Transaction signature</span>
            <input
              value={signature}
              onChange={(event) => setSignature(event.target.value)}
              placeholder="Signature from the submitted transfer"
              className="field-control mt-1.5 px-3 font-mono text-xs"
            />
          </label>
          {error && <p role="alert" className="rounded-md border border-down/35 bg-down/5 px-3 py-2 text-[11px] text-down">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !signature.trim()}
              onClick={async () => {
                const recorded = await post({ action: "sign", id: intent.id, signature: signature.trim() });
                if (!recorded) return;
                const settled = await post({ action: "settle", id: intent.id, outcome: "confirmed" });
                if (!settled) return;
                setIntent(null); setSignature(""); setOpen(false); setDestination(""); setAmountSol("");
                onDone();
              }}
              className="min-h-11 rounded-md bg-gold-400 px-4 text-xs font-semibold text-[#17110c] disabled:opacity-50"
            >
              {busy ? "Recording…" : "Record and confirm"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                await post({ action: "settle", id: intent.id, outcome: "failed", error: "abandoned by operator" });
                setIntent(null); setSignature(""); setOpen(false);
                onDone();
              }}
              className="min-h-11 rounded-md border border-edge px-4 text-xs font-semibold text-dim disabled:opacity-50"
            >
              Mark failed
            </button>
          </div>
          {/* Abandoning without settling would leave the amount committed for ever, so the
              second button exists and says what it does rather than being a Cancel that
              silently strands the balance. */}
          <p className="text-[10px] leading-4 text-dim">
            Marking it failed releases the committed amount back to available. Do that only if the transfer was never submitted.
          </p>
        </div>
      )}
    </div>
  );
}
