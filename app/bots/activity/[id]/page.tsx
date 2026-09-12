"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import AppShell from "@/components/AppShell";
import { EmptyState, PageHeader, ProductTabs, Segmented, StatusPill } from "@/components/product/Primitives";
import { useToast } from "@/components/Toast";
import {
  formatSol,
  formatWhen,
  productFetch,
  type BotActivityExecution,
  type BotActivitySignal
} from "@/lib/product-api";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

type ActivityResponse = {
  bot: { id: string; kind: string; name: string };
  signals: BotActivitySignal[];
  executions: BotActivityExecution[];
};

export default function BotActivityPage() {
  const params = useParams<{ id: string }>();
  const { authenticated, login, getAccessToken } = usePrivy();
  const toast = useToast();
  const [tab, setTab] = useState<"signals" | "executions">("signals");
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    if (!authenticated) return;
    setLoading(true);
    productFetch<ActivityResponse>(`/api/product/bot-activity?botId=${encodeURIComponent(params.id)}`, { getAccessToken })
      .then(setData)
      .catch((reason) => toast(reason instanceof Error ? reason.message : "Could not load bot activity", "err"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [authenticated, params.id]);

  if (!authenticated) {
    return <AppShell><PageHeader title="Calls and trades" description="Every call this bot saw, and what it did about each one." /><ProductTabs items={TABS} active="/bots/manage" /><div className="mt-6"><EmptyState icon={Activity} title="Connect to inspect this bot" description="Bot journals are private to the owning account." action={<button type="button" onClick={login} className="min-h-11 rounded-md bg-gold-400 px-4 t-body font-semibold text-[#17110c]">Connect account</button>} /></div></AppShell>;
  }

  return (
    <AppShell>
      <PageHeader

        title={data?.bot.name || "Signals and executions"}
        description="Rejected signals keep their reason; transaction failures keep their last recorded state."
        actions={<Link href="/bots/manage" className="inline-flex min-h-11 items-center rounded-md border border-edge px-4 t-body font-semibold text-ink">Back to My Bots</Link>}
      />
      <ProductTabs items={TABS} active="/bots/manage" />
      <section className="mt-5 flex items-center gap-3 border-y border-edge bg-panel/45 px-4 py-3">
        <Segmented value={tab} onChange={setTab} label="Journal view" options={[{ value: "signals", label: "Signals" }, { value: "executions", label: "Executions" }]} />
        <button type="button" onClick={load} className="ml-auto grid h-11 w-11 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh activity"><RefreshCw size={15} /></button>
      </section>
      {loading && !data ? <div className="mt-5 grid min-h-64 place-items-center rounded-md border border-edge bg-panel"><Loader2 className="animate-spin text-gold-400" /></div> : tab === "signals" ? <SignalTable rows={data?.signals || []} /> : <ExecutionTable rows={data?.executions || []} />}
    </AppShell>
  );
}

function SignalTable({ rows }: { rows: BotActivitySignal[] }) {
  if (!rows.length) return <div className="mt-5"><EmptyState icon={Activity} title="No signals recorded" description="Signals appear here after this bot receives an eligible source event." /></div>;
  return <div className="mt-5 overflow-x-auto rounded-md border border-edge"><table className="w-full min-w-[860px] text-left t-label"><thead className="ui-label bg-panel"><tr><th className="px-4 py-3">Status</th><th className="px-4 py-3">Mint</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Received</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-edge bg-void/45"><td className="px-4 py-4"><StatusPill status={row.status} /></td><td className="px-4 py-4 font-mono text-ink">{short(row.mint)}</td><td className="px-4 py-4 text-dim">{row.sourceType} · {row.sourceRef}</td><td className="max-w-sm px-4 py-4 text-dim">{row.reason || "No rejection or failure recorded"}</td><td className="px-4 py-4 font-mono text-dim">{formatWhen(row.receivedAt)}</td></tr>)}</tbody></table></div>;
}

function ExecutionTable({ rows }: { rows: BotActivityExecution[] }) {
  if (!rows.length) return <div className="mt-5"><EmptyState icon={Activity} title="No executions recorded" description="Trade intents and their latest submission state appear here." /></div>;
  return <div className="mt-5 overflow-x-auto rounded-md border border-edge"><table className="w-full min-w-[1060px] text-left t-label"><thead className="ui-label bg-panel"><tr><th className="px-4 py-3">State</th><th className="px-4 py-3">Intent</th><th className="px-4 py-3">Mint</th><th className="px-4 py-3">Notional</th><th className="px-4 py-3">Fees</th><th className="px-4 py-3">Signature / error</th><th className="px-4 py-3">Created</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-edge bg-void/45"><td className="px-4 py-4"><StatusPill status={row.executionStatus || row.state} /></td><td className="px-4 py-4 text-ink">{row.side} · {row.intentKind}</td><td className="px-4 py-4 font-mono text-ink">{short(row.mint)}</td><td className="px-4 py-4 font-mono text-dim">{row.grossNotionalLamports == null ? "—" : formatSol(row.grossNotionalLamports)}</td><td className="px-4 py-4 font-mono text-dim">{executionFees(row)}</td><td className="max-w-xs px-4 py-4 ui-code t-label text-dim">{row.txSignature ? short(row.txSignature) : row.errorMessage || row.errorCode || "Not submitted"}</td><td className="px-4 py-4 font-mono text-dim">{formatWhen(row.createdAt)}</td></tr>)}</tbody></table></div>;
}

function executionFees(row: BotActivityExecution) {
  const values = [row.networkFeeLamports, row.priorityFeeLamports, row.platformFeeLamports, row.creatorFeeLamports];
  if (values.every((value) => value == null)) return "—";
  return formatSol(values.reduce((sum, value) => sum + BigInt(value || 0), BigInt(0)));
}

function short(value: string | null) {
  if (!value) return "Unavailable";
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-5)}` : value;
}
