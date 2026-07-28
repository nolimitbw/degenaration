"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  Archive,
  Bot,
  Copy,
  Edit3,
  Eye,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw
} from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  EmptyState,
  PageHeader,
  ProductTabs,
  Segmented,
  StatusPill
} from "@/components/product/Primitives";
import { useToast } from "@/components/Toast";
import { productFetch, type BotKind, type ProductBot } from "@/lib/product-api";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

export default function BotManagerPage() {
  const { authenticated, login, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const toast = useToast();
  const [kind, setKind] = useState<BotKind>("discord");
  const [bots, setBots] = useState<ProductBot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!authenticated) {
      setBots([]);
      return;
    }
    setBots(null);
    productFetch<{ bots: ProductBot[] }>(`/api/product/bots?kind=${kind}`, { getAccessToken })
      .then((data) => setBots(data.bots || []))
      .catch((reason) => {
        setBots([]);
        toast(reason instanceof Error ? reason.message : "Could not load bots", "err");
      });
  }, [authenticated, getAccessToken, kind, toast]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    active: bots?.filter((bot) => bot.status === "active").length || 0,
    paused: bots?.filter((bot) => bot.status === "paused").length || 0,
    drafts: bots?.filter((bot) => bot.status === "draft").length || 0
  }), [bots]);

  async function saveBot(bot: ProductBot, status: ProductBot["status"], duplicate = false) {
    setBusy(bot.id);
    try {
      await productFetch("/api/product/bots", { getAccessToken, identityToken }, {
        method: "POST",
        body: JSON.stringify({
          id: duplicate ? undefined : bot.id,
          kind: bot.kind,
          name: duplicate ? `${bot.name} copy`.slice(0, 80) : bot.name,
          description: bot.description || "",
          status: duplicate ? "draft" : status,
          visibility: duplicate ? "private" : bot.visibility,
          executionMode: "paper",
          sourceGroupId: bot.sourceGroupId || null,
          confirmed: status === "active" && !duplicate,
          changeNote: duplicate ? "Duplicated from bot manager" : `Lifecycle changed to ${status}`,
          config: bot.config || {}
        })
      });
      toast(duplicate ? "Draft duplicated" : `Bot ${status === "active" ? "resumed" : status}`);
      load();
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not update bot", "err");
    } finally {
      setBusy(null);
    }
  }

  if (!authenticated) {
    return (
      <AppShell>
        <PageHeader eyebrow="Bots / Manager" title="My Bots" description="Manage Discord and KOL bot versions, lifecycle, and performance." />
        <ProductTabs items={TABS} active="/bots/manage" />
        <div className="mt-6">
          <EmptyState
            icon={Bot}
            title="Connect to manage your bots"
            description="Your bot configurations are private and only returned for the authenticated Privy user."
            action={<button type="button" onClick={login} className="min-h-10 rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]">Connect account</button>}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Bots / Manager"
        title="My Bots"
        description="Pause entries immediately, create immutable configuration versions, and preserve financial history when archiving."
        actions={
          <Link href={kind === "discord" ? "/bots/discord/new" : "/bots/kol/new"} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]">
            <Plus aria-hidden="true" size={16} />
            New {kind === "discord" ? "Discord" : "KOL"} bot
          </Link>
        }
      />
      <ProductTabs items={TABS} active="/bots/manage" />

      <section className="mt-5 flex flex-wrap items-center gap-3 border-y border-edge bg-panel/45 px-4 py-3">
        <Segmented value={kind} onChange={setKind} label="Bot kind" options={[{ value: "discord", label: "Discord Bots" }, { value: "kol", label: "KOL Bots" }]} />
        <div className="flex flex-wrap gap-4 font-mono text-[10px] text-dim">
          <span><strong className="text-up">{counts.active}</strong> active</span>
          <span><strong className="text-toxic">{counts.paused}</strong> paused</span>
          <span><strong className="text-ink">{counts.drafts}</strong> drafts</span>
        </div>
        <button type="button" onClick={load} className="ml-auto grid h-10 w-10 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh bots">
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </section>

      <div className="mt-5">
        {bots == null && <div className="grid min-h-64 place-items-center border border-edge bg-panel"><Loader2 className="animate-spin text-toxic" /></div>}
        {bots?.length === 0 && (
          <EmptyState
            icon={Bot}
            title={`No ${kind === "discord" ? "Discord" : "KOL"} bots yet`}
            description={kind === "discord" ? "Choose an approved Discord source and save your first execution profile." : "Build a scanner-driven strategy and save it as a private draft or submit it for review."}
            action={<Link href={kind === "discord" ? "/bots/discord/new" : "/bots/kol/new"} className="inline-flex min-h-10 items-center rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c]">Create bot</Link>}
          />
        )}
        {!!bots?.length && (
          <div className="overflow-x-auto rounded-md border border-edge">
            <table className="w-full min-w-[1180px] text-left">
              <thead className="bg-panel font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Bot</th>
                  <th className="px-4 py-3">Source / Strategy</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Open</th>
                  <th className="px-4 py-3">Followers</th>
                  <th className="px-4 py-3">30D net PnL</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((bot) => {
                  const editHref = `/bots/${bot.kind}/${bot.id}/edit`;
                  const isBusy = busy === bot.id;
                  return (
                    <tr key={bot.id} className="border-t border-edge bg-void/45 text-xs transition hover:bg-panel">
                      <td className="px-4 py-4"><StatusPill status={bot.status} /></td>
                      <td className="px-4 py-4">
                        <p className="max-w-48 truncate font-semibold text-ink">{bot.name}</p>
                        <p className="mt-1 max-w-48 truncate font-mono text-[9px] text-dim">{bot.id}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-48 truncate text-ink">{bot.kind === "discord" ? bot.sourceName || "Source unavailable" : bot.strategySlug || "Unpublished strategy"}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase text-dim">{bot.kind}{bot.moderationStatus ? ` · ${bot.moderationStatus}` : ""}</p>
                      </td>
                      <td className="px-4 py-4 font-mono text-ink">v{bot.version || 1}</td>
                      <td className="px-4 py-4 font-mono text-ink">{bot.openTrades || 0}</td>
                      <td className="px-4 py-4 font-mono text-ink">{bot.followers || 0}</td>
                      <td className="px-4 py-4 font-mono text-dim">{bot.netPnlLamports == null ? "--" : `${(Number(bot.netPnlLamports) / 1e9).toFixed(3)} SOL`}</td>
                      <td className="px-4 py-4 font-mono text-[10px] text-dim">{new Date(bot.updated_at || bot.updatedAt || Date.now()).toLocaleDateString()}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-1">
                          {isBusy ? (
                            <span className="grid h-9 w-9 place-items-center"><Loader2 size={15} className="animate-spin text-toxic" /></span>
                          ) : (
                            <>
                              <Link href={editHref} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label={`Edit ${bot.name}`} title="Edit"><Edit3 size={14} /></Link>
                              <Link href={`/portfolio?bot=${bot.id}&view=positions`} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label={`View ${bot.name} positions`} title="Positions"><Eye size={14} /></Link>
                              {bot.status === "active" ? (
                                <button type="button" onClick={() => saveBot(bot, "paused")} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-toxic" aria-label={`Pause ${bot.name}`} title="Pause entries"><Pause size={14} /></button>
                              ) : bot.status !== "archived" && (
                                <button type="button" onClick={() => saveBot(bot, "active")} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-up" aria-label={`Resume ${bot.name}`} title="Resume"><Play size={14} /></button>
                              )}
                              {bot.kind === "kol" && bot.status !== "archived" && (
                                <button type="button" onClick={() => saveBot(bot, "draft", true)} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label={`Duplicate ${bot.name}`} title="Duplicate as draft"><Copy size={14} /></button>
                              )}
                              {bot.status !== "archived" && (
                                <button type="button" onClick={() => saveBot(bot, "archived")} disabled={(bot.openTrades || 0) > 0} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim hover:text-down disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Archive ${bot.name}`} title={(bot.openTrades || 0) > 0 ? "Close positions before archiving" : "Archive"}><Archive size={14} /></button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
