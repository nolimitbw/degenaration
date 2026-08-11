"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { EmptyState, LoadingRows, Metric, StatusPill } from "@/components/product/Primitives";

/**
 * Spec section 8: one client's full record.
 *
 * Same custody honesty as the client table — no balance column, because the SOL is in a wallet
 * the client controls and the database cannot read a chain balance. Everything shown is
 * ledger-derived, and the wallet address is shown so the operator can look the rest up.
 *
 * Volume carries its definition on screen. Four windows, one predicate: confirmed executed
 * notional. A failed or simulated transaction is in none of them.
 */

type Detail = {
  ok: boolean;
  reason?: string;
  client: { privyUserId: string; status: string; createdAt: string };
  balances: Record<string, string>;
  volume: Record<string, string>;
  wallets: { address: string; status: string; is_primary: boolean; label: string | null }[];
  walletHistory: { action: string; address: string | null; created_at: string }[];
  positions: {
    id: string; mint: string; status: string; costLamports: string;
    realizedPnlLamports: string; lotCount: number; exitCount: number;
    unpricedExits: number; remainingBaseUnits: string; opened_at: string;
  }[];
  executions: {
    id: string; status: string; side: string; mint: string; txSignature: string | null;
    grossNotionalLamports: string; platformFeeLamports: string; created_at: string;
  }[];
  withdrawals: {
    id: string; state: string; amountLamports: string; txSignature: string | null;
    created_at: string;
  }[];
  cashMovements: { id: string; type: string; status: string; amountLamports: string; observed_at: string }[];
  commissions: { id: string; accountType: string; amountLamports: string; created_at: string }[];
  referral: { referredBy: string | null; referredCount: number; verifiedReferrals: number };
  bots: { id: string; name: string | null; kind: string; status: string; updated_at: string }[];
  failures: { kind: string; id: string; state: string; detail: string | null; at: string }[];
  auditEvents: { action: string; actor: string; reason: string | null; created_at: string }[];
  balanceNote: string;
};

function sol(lamports: string | number | null | undefined, decimals = 3): string {
  if (lamports == null) return "—";
  try {
    const value = BigInt(String(lamports));
    const negative = value < BigInt(0);
    const abs = negative ? -value : value;
    const whole = abs / BigInt(1_000_000_000);
    const frac = (abs % BigInt(1_000_000_000)).toString().padStart(9, "0").slice(0, decimals);
    return `${negative ? "-" : ""}${whole.toLocaleString()}.${frac}`;
  } catch {
    return "—";
  }
}

const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "—";
const short = (value: string | null, head = 6, tail = 4) =>
  value ? (value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value) : "—";

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-edge bg-panel">
      <header className="flex items-baseline justify-between gap-3 border-b border-edge px-4 py-3">
        <h3 className="t-label font-semibold text-ink">{title}</h3>
        {count != null && <span className="t-label text-dim">{count}</span>}
      </header>
      {children}
    </section>
  );
}

function Rows({ rows, empty }: { rows: React.ReactNode[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="px-4 py-4 t-label text-dim">{empty}</p>;
  }
  return <div className="divide-y divide-edge/60">{rows}</div>;
}

export default function ClientDetail({
  privyUserId,
  fetchJson,
  onBack
}: {
  privyUserId: string;
  fetchJson: <T>(path: string) => Promise<T>;
  onBack: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<Detail>(`/api/admin/clients/${encodeURIComponent(privyUserId)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this client.");
    } finally {
      setLoading(false);
    }
  }, [fetchJson, privyUserId]);

  useEffect(() => { void load(); }, [load]);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-11 sm:min-h-9 items-center gap-2 rounded-md border border-edge px-3 t-label font-semibold text-ink"
    >
      <ArrowLeft size={13} /> All clients
    </button>
  );

  if (loading && !data) {
    return <div className="space-y-4">{back}<LoadingRows count={6} /></div>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title="Client record unavailable" description={error || "No response."} />
      </div>
    );
  }

  if (!data.ok) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          title="No such client"
          description="This Privy ID does not match a registered client."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-mono t-body font-semibold text-ink">{data.client.privyUserId}</h2>
          <p className="mt-1 t-label text-dim">
            Registered {when(data.client.createdAt)} · <StatusPill status={data.client.status} />
          </p>
        </div>
        {back}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Volume today" value={`${sol(data.volume.todayLamports)} SOL`} detail="Confirmed executed" />
        <Metric label="Volume 7D" value={`${sol(data.volume.sevenDayLamports)} SOL`} detail={`30D ${sol(data.volume.thirtyDayLamports)}`} />
        <Metric label="Lifetime volume" value={`${sol(data.volume.lifetimeLamports)} SOL`} detail={`${sol(data.volume.platformFeeLamports, 4)} SOL fees`} />
        <Metric label="Realized PnL" value={`${sol(data.balances.realizedPnlLamports)} SOL`} detail={`${sol(data.balances.openCostLamports)} SOL open cost`} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Committed" value={`${sol(data.balances.committedLamports)} SOL`} detail="Reserved, not yet spent" />
        <Metric label="Withdrawn" value={`${sol(data.balances.withdrawnLamports)} SOL`} detail="Settled on chain" />
        <Metric label="Pending withdrawal" value={`${sol(data.balances.pendingWithdrawalLamports)} SOL`} detail="Not yet confirmed" />
        <Metric label="Commission balance" value={`${sol(data.balances.commissionBalanceLamports, 4)} SOL`} detail="As creator or referrer" />
      </div>

      <p className="t-label leading-4 text-dim">{data.volume.definition} · {data.balanceNote}</p>

      {data.failures.length > 0 && (
        <Section title="Failed operations" count={data.failures.length}>
          <Rows
            empty="Nothing has failed for this client."
            rows={data.failures.map((f) => (
              <div key={`${f.kind}-${f.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 t-label">
                <AlertCircle size={12} className="text-down" />
                <span className="font-semibold text-ink">{f.kind}</span>
                <StatusPill status={f.state} />
                <span className="text-dim">{f.detail || "No detail recorded"}</span>
                <span className="ml-auto t-label text-dim">{when(f.at)}</span>
              </div>
            ))}
          />
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Wallets" count={data.wallets.length}>
          <Rows
            empty="No wallet registered yet."
            rows={data.wallets.map((w) => (
              <div key={w.address} className="flex items-baseline justify-between gap-3 px-4 py-3 t-label">
                <span className="font-mono text-ink" title={w.address}>{short(w.address, 8, 6)}</span>
                <span className="text-dim">{w.is_primary ? "Primary" : w.status}</span>
              </div>
            ))}
          />
        </Section>

        <Section title="Wallet history" count={data.walletHistory.length}>
          <Rows
            empty="No wallet change has been recorded."
            rows={data.walletHistory.map((h, index) => (
              <div key={`${h.created_at}-${index}`} className="flex items-baseline justify-between gap-3 px-4 py-3 t-label">
                <span className="text-ink">{h.action}</span>
                <span className="font-mono text-dim">{short(h.address)}</span>
                <span className="t-label text-dim">{when(h.created_at)}</span>
              </div>
            ))}
          />
        </Section>
      </div>

      <Section title="Positions" count={data.positions.length}>
        <Rows
          empty="No position has been opened."
          rows={data.positions.map((p) => (
            <div key={p.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 t-label">
              <span className="font-mono text-ink">{short(p.mint, 6, 5)}</span>
              <StatusPill status={p.status} />
              <span className="text-dim">{sol(p.costLamports)} SOL cost</span>
              <span className={Number(p.realizedPnlLamports) >= 0 ? "text-up" : "text-down"}>
                {sol(p.realizedPnlLamports)} SOL realized
              </span>
              <span className="text-dim">
                {p.exitCount} exit{p.exitCount === 1 ? "" : "s"}
                {p.unpricedExits > 0 && ` · ${p.unpricedExits} unpriced`}
              </span>
              <span className="ml-auto t-label text-dim">{when(p.opened_at)}</span>
            </div>
          ))}
        />
      </Section>

      <Section title="Executions" count={data.executions.length}>
        <Rows
          empty="No execution has settled."
          rows={data.executions.map((e) => (
            <div key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 t-label">
              <span className="text-ink">{e.side}</span>
              <span className="font-mono text-dim">{short(e.mint, 6, 5)}</span>
              <StatusPill status={e.status} />
              <span className="font-mono text-dim">{sol(e.grossNotionalLamports)} SOL</span>
              <span className="font-mono text-dim">{sol(e.platformFeeLamports, 4)} fee</span>
              {e.txSignature && (
                <a
                  href={`https://solscan.io/tx/${e.txSignature}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-gold-400 underline-offset-2 hover:underline"
                >
                  {short(e.txSignature)}
                </a>
              )}
              <span className="ml-auto t-label text-dim">{when(e.created_at)}</span>
            </div>
          ))}
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Withdrawals" count={data.withdrawals.length}>
          <Rows
            empty="No withdrawal has been requested."
            rows={data.withdrawals.map((w) => (
              <div key={w.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 t-label">
                <span className="font-mono text-ink">{sol(w.amountLamports)} SOL</span>
                <StatusPill status={w.state} />
                <span className="ml-auto t-label text-dim">{when(w.created_at)}</span>
              </div>
            ))}
          />
        </Section>

        <Section title="Deposits and movements" count={data.cashMovements.length}>
          <Rows
            empty="No cash movement has been reconciled."
            rows={data.cashMovements.map((m) => (
              <div key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 t-label">
                <span className="text-ink">{m.type}</span>
                <StatusPill status={m.status} />
                <span className="font-mono text-dim">{sol(m.amountLamports)} SOL</span>
                <span className="ml-auto t-label text-dim">{when(m.observed_at)}</span>
              </div>
            ))}
          />
        </Section>

        <Section title="Commissions" count={data.commissions.length}>
          <Rows
            empty="No commission has accrued."
            rows={data.commissions.map((c) => (
              <div key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 t-label">
                <span className="text-ink">{c.accountType}</span>
                <span className="font-mono text-dim">{sol(c.amountLamports, 4)} SOL</span>
                <span className="ml-auto t-label text-dim">{when(c.created_at)}</span>
              </div>
            ))}
          />
        </Section>

        <Section title="Bots" count={data.bots.length}>
          <Rows
            empty="No bot has been created."
            rows={data.bots.map((b) => (
              <div key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 t-label">
                <span className="text-ink">{b.name || "Untitled"}</span>
                <span className="text-dim">{b.kind}</span>
                <StatusPill status={b.status} />
                <span className="ml-auto t-label text-dim">{when(b.updated_at)}</span>
              </div>
            ))}
          />
        </Section>
      </div>

      <Section title="Referral">
        <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 py-3 t-label">
          <span className="text-dim">
            Referred by <span className="font-mono text-ink">{data.referral.referredBy || "—"}</span>
          </span>
          <span className="text-dim">
            Invited <span className="text-ink">{data.referral.referredCount}</span>
          </span>
          <span className="text-dim">
            Verified <span className="text-ink">{data.referral.verifiedReferrals}</span>
          </span>
        </div>
      </Section>

      <Section title="Audit events" count={data.auditEvents.length}>
        <Rows
          empty="No admin action has touched this client."
          rows={data.auditEvents.map((a, index) => (
            <div key={`${a.created_at}-${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 t-label">
              <span className="text-ink">{a.action}</span>
              <span className="font-mono text-dim">{short(a.actor, 10, 4)}</span>
              <span className="text-dim">{a.reason || ""}</span>
              <span className="ml-auto t-label text-dim">{when(a.created_at)}</span>
            </div>
          ))}
        />
      </Section>
    </div>
  );
}
