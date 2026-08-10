"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Gauge, RefreshCw } from "lucide-react";
import ClientDetail from "@/components/admin/ClientDetail";
import { EmptyState, LoadingRows, Metric, StatusPill } from "@/components/product/Primitives";

/**
 * Spec section 8: the operator's view of every client and the business totals.
 *
 * Deliberately has no "balance" column. DegenAration is non-custodial — a client's SOL sits
 * in a wallet they control and the server cannot read a chain balance from SQL. The wallet
 * address is shown instead so the operator can look it up, and the footer says so. A column
 * of numbers the database cannot verify would be worse than none.
 *
 * The table and the header totals load from one request but render independently: if one
 * side is unavailable the other still shows, matching the allSettled behaviour the Affiliate
 * and Portfolio dashboards use. A stale figure with a visible notice beats a blank page.
 */

/**
 * A windowed volume the deployed RPC may not return yet.
 *
 * An absent field is NOT zero. Rendering "0.00" for a column the server never sent would
 * report a client as inactive on no evidence, which is the failure mode this product has
 * had to correct repeatedly.
 */
function period(value?: string) {
  return value == null ? "—" : sol(value);
}

/** Operations on this client that need a human: failed legs, failed payouts, unreconciled. */
function attention(client: Client) {
  return (client.failedExecutions || 0) + (client.failedWithdrawals || 0) + (client.reconciliationWarnings || 0);
}

type Client = {
  privyUserId: string;
  status: string;
  createdAt: string;
  walletAddress: string | null;
  executedVolumeLamports: string;
  executionCount: number;
  // Optional: an older deployed RPC does not return these, and the column then reads "—"
  // rather than a fabricated zero.
  volumeTodayLamports?: string;
  volume7dLamports?: string;
  volume30dLamports?: string;
  failedExecutions?: number;
  failedWithdrawals?: number;
  reconciliationWarnings?: number;
  platformFeeLamports: string;
  creatorFeeLamports: string;
  committedLamports: string;
  openPositions: number;
  openCostLamports: string;
  realizedPnlLamports: string;
  withdrawnLamports: string;
  pendingWithdrawalLamports: string;
  discordBots: number;
  kolBots: number;
  commissionBalanceLamports: string;
  lastTradeAt: string | null;
};

type Payload = {
  clients: { clients: Client[]; custodyModel: string; balanceNote: string } | null;
  clientsError: string | null;
  summary: Record<string, string | number> | null;
  summaryError: string | null;
};

/** Lamports arrive as text so a large value cannot lose precision. Format, never re-math. */
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

const shortId = (id: string) => (id.length > 22 ? `${id.slice(0, 18)}…` : id);
const shortAddr = (a: string | null) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : null);

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 sm:min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink"
    >
      <RefreshCw size={13} /> Try again
    </button>
  );
}

export default function ClientLedger({
  fetchJson,
  refreshPerformance
}: {
  fetchJson: <T>(path: string) => Promise<T>;
  refreshPerformance?: () => Promise<number>;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputed, setRecomputed] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchJson<Payload>("/api/admin/clients?limit=200"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load clients.");
    } finally {
      setLoading(false);
    }
  }, [fetchJson]);

  useEffect(() => { void load(); }, [load]);

  const recompute = useCallback(async () => {
    if (!refreshPerformance) return;
    setRecomputing(true);
    setRecomputed(null);
    setError(null);
    try {
      const count = await refreshPerformance();
      setRecomputed(
        count === 0
          ? "No reconciled trades yet, so there is nothing to measure."
          : `${count} snapshot${count === 1 ? "" : "s"} recomputed.`
      );
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not recompute performance.");
    } finally {
      setRecomputing(false);
    }
  }, [load, refreshPerformance]);

  // The drill-down replaces the table rather than nesting inside it: section 8's client
  // record is a page's worth of lists, and an expanding row would push the table off screen.
  if (opened) {
    return <ClientDetail privyUserId={opened} fetchJson={fetchJson} onBack={() => setOpened(null)} />;
  }

  if (loading && !data) return <LoadingRows count={6} />;

  if (error && !data) {
    return (
      <EmptyState
        title="Client ledger unavailable"
        description={error}
        action={<RetryButton onClick={() => void load()} />}
      />
    );
  }

  const summary = data?.summary;
  const clients = data?.clients?.clients ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Clients</h2>
          <p className="mt-1 text-[11px] text-dim">
            Ledger-derived. Balances live on chain, not in the database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {refreshPerformance && (
            <button
              type="button"
              onClick={() => void recompute()}
              disabled={recomputing}
              title="Recompute portfolio, bot, KOL and Discord performance from the ledger"
              className="inline-flex min-h-11 sm:min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-dim transition hover:border-gold-400/50 hover:text-ink disabled:opacity-50"
            >
              <Gauge size={13} className={recomputing ? "animate-pulse" : undefined} />
              {recomputing ? "Recomputing…" : "Recompute performance"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 sm:min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} /> Refresh
          </button>
        </div>
      </div>

      {recomputed && (
        <p className="rounded-md border border-up/35 bg-up/5 px-3 py-2 text-[11px] text-up">{recomputed}</p>
      )}
      {error && data && (
        <p className="flex items-center gap-2 rounded-md border border-down/35 bg-down/5 px-3 py-2 text-[11px] text-down">
          <AlertCircle size={13} /> {error}
        </p>
      )}

      {data?.summaryError && (
        <p className="flex items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 text-[11px] text-dim">
          <AlertCircle size={13} className="text-warn" /> Totals unavailable — the client table below is still current.
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Clients" value={String(summary.clients ?? 0)} detail={`${summary.clientsWithWallet ?? 0} with a registered wallet`} />
          <Metric label="Executed volume" value={`${sol(summary.executedVolumeLamports)} SOL`} detail="Confirmed and reconciled" />
          <Metric label="Platform fees" value={`${sol(summary.platformFeeLamports, 4)} SOL`} detail={`${sol(summary.retainedFeeLamports, 4)} SOL retained`} />
          <Metric label="Pending withdrawals" value={`${sol(summary.pendingWithdrawalLamports)} SOL`} detail={`${sol(summary.withdrawnLamports)} SOL settled`} />
        </div>
      )}

      {data?.clientsError ? (
        <EmptyState
          title="Client table unavailable"
          description={data.clientsError}
          action={<RetryButton onClick={() => void load()} />}
        />
      ) : clients.length === 0 ? (
        <EmptyState title="No clients yet" description="Clients appear here after their first sign-in." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-edge text-[10px] uppercase tracking-wide text-dim">
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Wallet</th>
                <th className="px-4 py-3 text-right font-medium" title="UTC day">Volume today</th>
                <th className="px-4 py-3 text-right font-medium">7D</th>
                <th className="px-4 py-3 text-right font-medium">30D</th>
                <th className="px-4 py-3 text-right font-medium">Lifetime</th>
                <th className="px-4 py-3 text-right font-medium">Fees</th>
                <th className="px-4 py-3 text-right font-medium">Committed</th>
                <th className="px-4 py-3 text-right font-medium">Open</th>
                <th className="px-4 py-3 text-right font-medium">Withdrawn</th>
                <th className="px-4 py-3 text-center font-medium">Bots</th>
                <th className="px-4 py-3 font-medium">Last trade</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Open client</span></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.privyUserId} className="border-b border-edge/60 last:border-0">
                  <td className="px-4 py-3">
                    <span className="text-[12px] text-ink">{shortId(c.privyUserId)}</span>
                    {c.status !== "active" && <StatusPill status={c.status} />}
                  </td>
                  <td className="px-4 py-3">
                    {c.walletAddress ? (
                      <span className="text-[12px] text-dim" title={c.walletAddress}>
                        {shortAddr(c.walletAddress)}
                      </span>
                    ) : (
                      <span className="text-[11px] text-dim">Not registered</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">{period(c.volumeTodayLamports)}</td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">{period(c.volume7dLamports)}</td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">{period(c.volume30dLamports)}</td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-ink">
                    {sol(c.executedVolumeLamports)}
                    <span className="ml-1 text-[10px] text-dim">({c.executionCount})</span>
                    {attention(c) > 0 && (
                      <span
                        className="ml-2 rounded bg-down/15 px-1.5 py-0.5 text-[9px] font-semibold text-down"
                        title={`${c.failedExecutions || 0} failed execution(s), ${c.failedWithdrawals || 0} failed withdrawal(s), ${c.reconciliationWarnings || 0} unreconciled`}
                      >
                        {attention(c)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">{sol(c.platformFeeLamports, 4)}</td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">{sol(c.committedLamports)}</td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">
                    {c.openPositions > 0 ? `${c.openPositions} · ${sol(c.openCostLamports)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right ui-figure tabular-nums text-dim">
                    {sol(c.withdrawnLamports)}
                    {c.pendingWithdrawalLamports !== "0" && (
                      <span className="ml-1 text-[10px] text-warn">+{sol(c.pendingWithdrawalLamports)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-[11px] text-dim">
                    {c.discordBots + c.kolBots === 0 ? "—" : `${c.discordBots}D · ${c.kolBots}K`}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-dim">
                    {c.lastTradeAt ? new Date(c.lastTradeAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpened(c.privyUserId)}
                      className="inline-flex min-h-11 sm:min-h-9 items-center rounded-md border border-edge px-3 text-xs font-semibold text-ink"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.clients?.balanceNote && (
        <p className="text-[10px] leading-4 text-dim">{data.clients.balanceNote}</p>
      )}
    </div>
  );
}
