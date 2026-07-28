"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, ExternalLink, Loader2, Share2, WalletCards } from "lucide-react";
import AppShell from "@/components/AppShell";
import { EmptyState, PageHeader, StatusPill } from "@/components/product/Primitives";
import type { PortfolioSummary } from "@/components/product/PortfolioDashboard";
import { useToast } from "@/components/Toast";
import { formatSol, formatWhen, productFetch } from "@/lib/product-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;

export default function PositionDetailsPage() {
  const { authenticated, login, getAccessToken } = usePrivy();
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const id = typeof params.id === "string" ? params.id : "";
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated || !UUID.test(id)) return;
    setLoading(true);
    productFetch<PortfolioSummary>("/api/product/portfolio?period=3m", { getAccessToken })
      .then(setSummary)
      .catch((reason) => toast(reason instanceof Error ? reason.message : "Could not load position", "err"))
      .finally(() => setLoading(false));
  }, [authenticated, getAccessToken, id, toast]);

  const position = summary?.positions.find((row) => row.id === id);
  const executions = useMemo(() => {
    if (!position || !summary) return [];
    const opened = new Date(position.opened_at).getTime();
    const closed = position.closed_at ? new Date(position.closed_at).getTime() : Number.POSITIVE_INFINITY;
    return summary.executions.filter((row) => (
      row.botId === position.botId &&
      row.mint === position.mint &&
      new Date(row.created_at).getTime() >= opened &&
      new Date(row.created_at).getTime() <= closed
    ));
  }, [position, summary]);

  return (
    <AppShell>
      <Link href="/portfolio?view=positions" className="mb-5 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-dim hover:text-ink">
        <ArrowLeft size={15} /> Back to positions
      </Link>
      <PageHeader
        eyebrow="Private position record"
        title="Position details"
        description="Reconciled position state, costs, realized result, fees, and matching execution history."
      />

      {!authenticated && (
        <div className="mt-6">
          <EmptyState
            icon={WalletCards}
            title="Connect to view this position"
            description="Position records are scoped to your verified Privy account."
            action={<button type="button" onClick={login} className="min-h-10 rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]">Connect account</button>}
          />
        </div>
      )}

      {authenticated && !UUID.test(id) && (
        <div className="mt-6"><EmptyState title="Invalid position reference" description="This position link is malformed or incomplete." /></div>
      )}

      {authenticated && loading && (
        <div className="mt-6 grid min-h-64 place-items-center border border-edge bg-panel"><Loader2 className="animate-spin text-toxic" /></div>
      )}

      {authenticated && !loading && summary && !position && (
        <div className="mt-6"><EmptyState title="Position not found" description="This position does not exist or does not belong to your account." /></div>
      )}

      {position && (
        <>
          <section className="mt-6 overflow-hidden rounded-md border border-edge bg-panel">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-edge px-5 py-4">
              <div className="min-w-0">
                <p className="field-label">Token mint</p>
                <p className="mt-2 break-all font-mono text-xs text-ink">{position.mint}</p>
              </div>
              <StatusPill status={position.status} />
            </div>
            <dl className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
              <Detail label="Bot" value={position.botName || "Unassigned"} />
              <Detail label="Invested" value={formatSol(position.costLamports)} />
              <Detail label="Realized PnL" value={formatSol(position.realizedPnlLamports)} tone={Number(position.realizedPnlLamports) >= 0 ? "positive" : "negative"} />
              <Detail label="Recorded fees" value={formatSol(position.feesLamports)} />
              <Detail label="Token quantity" value={position.quantityBaseUnits || "--"} />
              <Detail label="Opened" value={formatWhen(position.opened_at)} />
              <Detail label="Last update" value={formatWhen(position.updated_at)} />
              <Detail label="Closed" value={formatWhen(position.closed_at)} />
            </dl>
          </section>

          <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
              <div><h2 className="text-sm font-semibold text-ink">Matching executions</h2><p className="mt-1 text-[11px] text-dim">Bot, mint, and position lifetime are used to match execution records.</p></div>
              {position.botId && <Link href={`/portfolio?bot=${encodeURIComponent(position.botId)}&view=trades`} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink"><Share2 size={13} /> Bot history</Link>}
            </header>
            {executions.length === 0 ? <p className="px-5 py-12 text-center text-xs text-dim">No matching executions are available.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left">
                  <thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Side</th><th className="px-4 py-3">Kind</th><th className="px-4 py-3">Notional</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Transaction</th></tr></thead>
                  <tbody>{executions.map((row) => <tr key={row.id} className="border-t border-edge text-xs"><td className="px-4 py-4 font-mono text-[9px] text-dim">{formatWhen(row.created_at)}</td><td className={`px-4 py-4 font-mono uppercase ${row.side === "buy" ? "text-up" : "text-toxic"}`}>{row.side}</td><td className="px-4 py-4 text-ink">{row.kind || "swap"}</td><td className="px-4 py-4 font-mono text-ink">{formatSol(row.grossNotionalLamports)}</td><td className="px-4 py-4"><StatusPill status={row.status} /></td><td className="px-4 py-4">{SOLANA_SIGNATURE.test(row.txSignature || "") ? <a href={`https://solscan.io/tx/${row.txSignature}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-toxic">Solscan <ExternalLink size={12} /></a> : <span className="text-dim">--</span>}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}

function Detail({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "positive" | "negative" }) {
  const color = tone === "positive" ? "text-up" : tone === "negative" ? "text-down" : "text-ink";
  return <div className="min-w-0 bg-panel p-5"><dt className="field-label">{label}</dt><dd className={`mt-2 break-words font-mono text-sm ${color}`}>{value}</dd></div>;
}
