"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  Archive,
  Bot,
  CircleHelp,
  Copy,
  Edit3,
  Eye,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  X
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
import { formatSol, productFetch, type BotKind, type ProductBot } from "@/lib/product-api";
import { AUTOMATED_MAINNET_RELEASE } from "@/lib/trading-release";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProductBot | null>(null);

  const load = useCallback(() => {
    if (!authenticated) {
      setBots([]);
      setLoadError(null);
      return;
    }
    setBots(null);
    setLoadError(null);
    productFetch<{ bots: ProductBot[] }>(`/api/product/bots?kind=${kind}`, { getAccessToken })
      .then((data) => setBots(data.bots || []))
      .catch((reason) => {
        const message = reason instanceof Error ? reason.message : "Could not load bots";
        setLoadError(message);
        toast(message, "err");
      });
  }, [authenticated, getAccessToken, kind, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!archiveTarget) return;
    const previousOverflow = document.body.style.overflow;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy !== archiveTarget.id) setArchiveTarget(null);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", close);
    };
  }, [archiveTarget, busy]);

  const counts = useMemo(() => ({
    active: bots?.filter((bot) => bot.status === "active").length || 0,
    paused: bots?.filter((bot) => bot.status === "paused").length || 0,
    drafts: bots?.filter((bot) => bot.status === "draft").length || 0
  }), [bots]);

  async function saveBot(bot: ProductBot, status: ProductBot["status"], duplicate = false) {
    if (status === "active" && !AUTOMATED_MAINNET_RELEASE.enabled) {
      toast(AUTOMATED_MAINNET_RELEASE.reason, "err");
      return false;
    }
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
          executionMode: "solana-mainnet",
          sourceGroupId: bot.sourceGroupId || null,
          confirmed: status === "active" && !duplicate,
          changeNote: duplicate ? "Duplicated from bot manager" : `Lifecycle changed to ${status}`,
          config: bot.config || {}
        })
      });
      toast(duplicate ? "Draft duplicated" : `Bot ${status === "active" ? "resumed" : status}`);
      load();
      return true;
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not update bot", "err");
      return false;
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
            description="Your bot configurations are private and only returned for your authenticated account."
            action={<button type="button" onClick={login} className="min-h-11 sm:min-h-10 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]">Connect account</button>}
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
          <Link href={kind === "discord" ? "/bots/discord/new" : "/bots/kol/new"} className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]">
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
          <span><strong className="text-gold-400">{counts.paused}</strong> paused</span>
          <span><strong className="text-ink">{counts.drafts}</strong> drafts</span>
        </div>
        <button type="button" onClick={load} className="ml-auto grid h-11 w-11 place-items-center sm:h-10 sm:w-10 rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh bots">
          <RefreshCw aria-hidden="true" size={15} />
        </button>
      </section>
      <p className="mt-3 rounded-md border border-gold-400/30 bg-gold-400/5 px-4 py-3 text-xs leading-5 text-dim">
        Drafts remain editable on {AUTOMATED_MAINNET_RELEASE.label}. {AUTOMATED_MAINNET_RELEASE.reason}
      </p>

      <div className="mt-5">
        {bots == null && !loadError && <div className="grid min-h-64 place-items-center border border-edge bg-panel"><Loader2 className="animate-spin text-gold-400" /></div>}
        {bots == null && loadError && (
          <div className="rounded-md border border-edge bg-panel p-6">
            <p className="text-sm font-semibold text-ink">Bots could not be loaded</p>
            <p className="mt-1 text-xs leading-5 text-dim">{loadError}</p>
            <button type="button" onClick={load} className="mt-4 inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-xs font-semibold text-ink"><RefreshCw size={14} /> Try again</button>
          </div>
        )}
        {bots?.length === 0 && (
          <EmptyState
            icon={Bot}
            title={`No ${kind === "discord" ? "Discord" : "KOL"} bots yet`}
            description={kind === "discord" ? "Choose an approved Discord source and save your first execution profile." : "Build a scanner-driven strategy and save it as a private draft or submit it for review."}
            action={<Link href={kind === "discord" ? "/bots/discord/new" : "/bots/kol/new"} className="inline-flex min-h-11 sm:min-h-10 items-center rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c]">Create bot</Link>}
          />
        )}
        {!!bots?.length && (
          <div className="overflow-x-auto rounded-md border border-edge">
            <table className="w-full min-w-[1280px] text-left">
              <thead className="bg-panel font-mono text-[9px] uppercase tracking-[0.06em] text-dim">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Bot</th>
                  <th className="px-4 py-3">Source / Strategy</th>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Trades</th>
                  <th className="px-4 py-3">Followers</th>
                  <th className="px-4 py-3">30D net PnL</th><th className="px-4 py-3">30D volume</th><th className="px-4 py-3">30D fees</th><th className="px-4 py-3">Max capital</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bots.map((bot) => {
                  const editHref = `/bots/${bot.kind}/${bot.id}/edit`;
                  const isBusy = busy === bot.id;
                  const totalFees = botFeeTotal(bot);
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
                      <td className="px-4 py-4 font-mono text-ink">{bot.openTrades || 0}<span className="text-dim">/{Number(bot.config?.maxOpenTrades) || "--"}</span></td>
                      <td className="px-4 py-4 font-mono text-ink">{bot.followers || 0}</td>
                      <td className="px-4 py-4 font-mono text-dim">{bot.netPnlLamports == null ? "--" : `${(Number(bot.netPnlLamports) / 1e9).toFixed(3)} SOL`}</td>
                      <td className="px-4 py-4 font-mono text-dim">{bot.volumeLamports == null ? "--" : formatSol(bot.volumeLamports)}</td>
                      <td className="px-4 py-4 font-mono text-dim">
                        <div className="flex items-center gap-1.5">
                          <p>{totalFees == null ? "--" : formatSol(totalFees)}</p>
                          <span tabIndex={0} aria-label={feeBreakdown(bot)} title={feeBreakdown(bot)} className="text-dim outline-none focus:text-gold-400"><CircleHelp aria-hidden="true" size={12} /></span>
                        </div>
                        <p className="mt-1 text-[9px]">Gas {bot.networkFeesLamports == null ? "--" : formatSol(bot.networkFeesLamports)}</p>
                      </td>
                      <td className="px-4 py-4 font-mono text-dim">{bot.config?.maximumCapitalLamports == null ? "--" : formatSol(bot.config.maximumCapitalLamports)}</td>
                      <td className="px-4 py-4 font-mono text-[10px] text-dim">{new Date(bot.updated_at || bot.updatedAt || Date.now()).toLocaleDateString()}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-1">
                          {isBusy ? (
                            <span className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9"><Loader2 size={15} className="animate-spin text-gold-400" /></span>
                          ) : (
                            <>
                              <Link href={editHref} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-ink" aria-label={`Edit ${bot.name}`} title="Edit"><Edit3 size={14} /></Link>
                              <Link href={`/portfolio?bot=${bot.id}&view=positions`} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-ink" aria-label={`View ${bot.name} positions`} title="Positions"><Eye size={14} /></Link>
                              {bot.status === "active" ? (
                                <button type="button" onClick={() => saveBot(bot, "paused")} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-gold-400" aria-label={`Pause ${bot.name}`} title="Pause entries"><Pause size={14} /></button>
                              ) : bot.status !== "archived" && (
                                <button
                                  type="button"
                                  disabled
                                  className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-md border border-edge text-dim opacity-40"
                                  aria-label={`Activation unavailable for ${bot.name}`}
                                  title={AUTOMATED_MAINNET_RELEASE.reason}
                                >
                                  <Play size={14} />
                                </button>
                              )}
                              {bot.kind === "kol" && bot.status !== "archived" && (
                                <button type="button" onClick={() => saveBot(bot, "draft", true)} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-ink" aria-label={`Duplicate ${bot.name}`} title="Duplicate as draft"><Copy size={14} /></button>
                              )}
                              {bot.status !== "archived" && (
                                <button type="button" onClick={() => setArchiveTarget(bot)} disabled={(bot.openTrades || 0) > 0} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-down disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Archive ${bot.name}`} title={(bot.openTrades || 0) > 0 ? "Close positions before archiving" : "Archive"}><Archive size={14} /></button>
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

      {archiveTarget && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== archiveTarget.id) setArchiveTarget(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="archive-bot-title" className="w-full max-w-lg overflow-hidden rounded-md border border-edge bg-panel shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-edge p-5">
              <div><p className="font-mono text-[9px] uppercase text-gold-400">Bot lifecycle</p><h2 id="archive-bot-title" className="mt-2 text-lg font-semibold text-ink">Archive {archiveTarget.name}?</h2></div>
              <button type="button" onClick={() => setArchiveTarget(null)} disabled={busy === archiveTarget.id} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim disabled:opacity-40" aria-label="Close archive confirmation"><X size={16} /></button>
            </header>
            <div className="space-y-4 p-5">
              <p className="text-sm leading-6 text-dim">The bot leaves active management and cannot open new positions. Its versions, executions, performance, and financial history remain available.</p>
              <div className="rounded-md border border-edge bg-void p-3 text-xs text-dim"><span className="font-semibold text-ink">Open positions:</span> {archiveTarget.openTrades || 0}</div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setArchiveTarget(null)} disabled={busy === archiveTarget.id} className="min-h-11 rounded-md border border-edge px-4 text-sm font-semibold text-ink disabled:opacity-40">Cancel</button>
                <button
                  type="button"
                  disabled={busy === archiveTarget.id || (archiveTarget.openTrades || 0) > 0}
                  onClick={async () => { if (await saveBot(archiveTarget, "archived")) setArchiveTarget(null); }}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-down px-4 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {busy === archiveTarget.id && <Loader2 size={14} className="animate-spin" />}
                  Archive bot
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

function botFeeTotal(bot: ProductBot) {
  const values = [bot.networkFeesLamports, bot.platformFeesLamports, bot.creatorFeesLamports];
  if (values.every((value) => value == null)) return null;
  try {
    return values.reduce((total, value) => total + BigInt(value || 0), BigInt(0));
  } catch {
    return null;
  }
}

function feeBreakdown(bot: ProductBot) {
  const item = (label: string, value: number | string | null | undefined) => `${label}: ${value == null ? "unavailable" : formatSol(value)}`;
  return [
    item("Network", bot.networkFeesLamports),
    item("Platform", bot.platformFeesLamports),
    item("Creator", bot.creatorFeesLamports)
  ].join(" · ");
}
