"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BadgeCheck, Bot, RadioTower } from "lucide-react";
import AppShell from "@/components/AppShell";
import { DiscordSourceAvatar } from "@/components/product/DiscordSourceVisual";
import { EmptyState, Metric, PageHeader, ProductTabs, Segmented, StatusPill } from "@/components/product/Primitives";
import { formatPercentBps, formatWhen, productFetch, type DiscordSource } from "@/lib/product-api";
import { safeDiscordInvite } from "@/lib/external-url";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

type Period = "1d" | "7d" | "30d";

export default function DiscordSourceDetailsPage() {
  const params = useParams<{ id: string }>();
  const [period, setPeriod] = useState<Period>("7d");
  const [source, setSource] = useState<DiscordSource | null | undefined>(undefined);
  const joinUrl = safeDiscordInvite(source?.joinUrl);

  useEffect(() => {
    setSource(undefined);
    productFetch<{ sources: DiscordSource[] }>(`/api/product/marketplace/discord?period=${period}`)
      .then((data) => setSource((data.sources || []).find((item) => item.id === params.id) || null))
      .catch(() => setSource(null));
  }, [params.id, period]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Bots / Discord / Source"
        title={source?.name || "Discord source"}
        description="Measured call history and approved channel coverage. Past performance is not a guarantee of future execution."
        actions={
          <>
            <Link href="/bots/discord" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink"><ArrowLeft size={15} /> Marketplace</Link>
            {source && <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]"><Bot size={15} /> Configure bot</Link>}
          </>
        }
      />
      <ProductTabs items={TABS} active="/bots/discord" />

      {source === undefined && <div className="mt-6 h-96 animate-pulse rounded-md border border-edge bg-panel" />}
      {source === null && <div className="mt-6"><EmptyState icon={RadioTower} title="Source unavailable" description="This source may be unapproved, suspended, removed, or temporarily unavailable." /></div>}
      {source && (
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <section className="overflow-hidden rounded-md border border-edge bg-panel">
              <header className="flex flex-wrap items-start gap-4 border-b border-edge p-5">
                <DiscordSourceAvatar source={source} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-ink">{source.name}</h2><StatusPill status={source.verificationStatus} /><StatusPill status={source.integrationHealth} /></div>
                  <p className="mt-2 font-mono text-[10px] text-dim">{source.members || "Member count unavailable"} · {source.activeFollowers} active followers · {source.channels.length} approved channels</p>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-dim">{source.description}</p>
                  {source.ownerDisplayName && <p className="mt-2 font-mono text-[10px] text-dim">Source owner: {source.ownerDisplayName}</p>}
                </div>
                {joinUrl && <a href={joinUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink">Join server <ArrowUpRight size={14} /></a>}
              </header>
              <div className="flex justify-end border-b border-edge p-3"><Segmented value={period} onChange={setPeriod} label="Source performance period" options={[{ value: "1d", label: "1D" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }]} /></div>
              <div className="grid grid-cols-2 divide-x divide-y divide-edge sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0 py-4">
                <Metric label="Eligible calls" value={source.eligibleCalls} />
                <Metric label="Measured" value={source.measuredCalls} />
                <Metric label="2x rate" value={source.winRate == null ? "--" : `${source.winRate.toFixed(1)}%`} tone="positive" />
                <Metric label="Median peak" value={source.medianReturnX == null ? "--" : `${source.medianReturnX.toFixed(2)}x`} />
                <Metric label="Average peak" value={source.averageReturnX == null ? "--" : `${source.averageReturnX.toFixed(2)}x`} />
                <Metric label="Max drawdown" value={formatPercentBps(source.maxDrawdownBps)} tone={source.maxDrawdownBps == null ? "default" : "negative"} />
                <Metric label="Creator fee" value={formatPercentBps(source.creatorFeeBps)} />
              </div>
            </section>

            <section className="rounded-md border border-edge bg-panel">
              <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Result distribution</h2><p className="mt-1 text-[11px] text-dim">All eligible calls in the selected period, including losing and unmeasured outcomes.</p></header>
              <div className="grid grid-cols-2 gap-px bg-edge sm:grid-cols-4">
                {[
                  ["Below +50%", source.under50, "text-down"],
                  ["Reached +50%", source.plus50, "text-toxic"],
                  ["Reached 2x", source.twoX, "text-up"],
                  ["Reached 5x+", source.fiveX, "text-up"]
                ].map(([label, value, tone]) => <div key={label as string} className="bg-void p-5"><p className={`font-mono text-2xl font-semibold ${tone}`}>{value}</p><p className="mt-2 text-xs text-dim">{label}</p></div>)}
              </div>
            </section>

            <section className="rounded-md border border-edge bg-panel">
              <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Approved call channels</h2><p className="mt-1 text-[11px] text-dim">Only these channels can produce eligible signals.</p></header>
              <div className="divide-y divide-edge">
                {source.channels.length === 0 && <p className="px-5 py-6 text-xs text-dim">No approved channel metadata is currently available.</p>}
                {source.channels.map((channel) => <div key={channel.id} className="flex items-center gap-3 px-5 py-4"><BadgeCheck size={16} className="text-up" /><div><p className="text-xs font-semibold text-ink">#{channel.name || "approved-channel"}</p><p className="mt-1 font-mono text-[9px] text-dim">{channel.id}</p></div></div>)}
              </div>
            </section>
          </div>

          <aside className="h-fit rounded-md border border-edge bg-panel xl:sticky xl:top-24">
            <header className="border-b border-edge p-5"><p className="font-mono text-[9px] uppercase text-toxic">Source integrity</p><h2 className="mt-2 text-base font-semibold text-ink">Execution eligibility</h2></header>
            <div className="space-y-4 p-5">
              <div className="flex gap-3"><BadgeCheck className="shrink-0 text-up" size={17} /><div><p className="text-xs font-semibold text-ink">Admin approved</p><p className="mt-1 text-[11px] leading-5 text-dim">Signals still pass parser, token, route, and user filter checks.</p></div></div>
              <div className="flex gap-3"><RadioTower className="shrink-0 text-toxic" size={17} /><div><p className="text-xs font-semibold text-ink">Last signal</p><p className="mt-1 text-[11px] leading-5 text-dim">{formatWhen(source.lastSignalAt)}</p></div></div>
              <div className="flex gap-3"><RadioTower className="shrink-0 text-toxic" size={17} /><div><p className="text-xs font-semibold text-ink">Profile synchronization</p><p className="mt-1 text-[11px] leading-5 text-dim">{formatWhen(source.profileSyncedAt)} · {source.integrationHealth}</p></div></div>
              <div className="rounded-md border border-edge bg-void p-3"><p className="font-mono text-[9px] uppercase text-dim">Minimum history</p><p className="mt-2 text-xs text-ink">{source.measuredCalls >= 5 ? "Measured sample is available." : "Insufficient measured history; performance ranking is provisional."}</p></div>
              <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]">Use this source</Link>
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
