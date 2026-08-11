"use client";

import { useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Link2,
  RadioTower,
  Search,
  ShieldAlert,
  Users,
  WalletCards
} from "lucide-react";
import { EmptyState, StatusPill } from "@/components/product/Primitives";
import { safeDiscordInvite } from "@/lib/external-url";
import type {
  AdminAction,
  AdminData,
  AdminTab,
  Application,
  Channel,
  KolStrategy,
  Payout,
  ReferralAttribution
} from "@/components/admin/types";

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function formatSol(value: string | number | undefined) {
  const lamports = Number(value || 0);
  return `${(lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
}

function compact(value?: string | null, start = 6, end = 5) {
  if (!value) return "Not available";
  return value.length > start + end + 3 ? `${value.slice(0, start)}...${value.slice(-end)}` : value;
}

function MetricStrip({ items }: { items: Array<{ label: string; value: React.ReactNode; tone?: string }> }) {
  return (
    <div className="grid overflow-hidden rounded-md border border-edge bg-panel sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="border-b border-edge p-4 sm:border-r xl:border-b-0 last:border-r-0">
          <p className="ui-label">{item.label}</p>
          <p className={`mt-2 ui-figure t-title font-semibold tabular-nums ${item.tone || "text-ink"}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 className="t-body font-semibold text-ink">{title}</h2>
      {detail && <p className="t-label text-dim">{detail}</p>}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  tone = "neutral"
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "positive" | "negative";
}) {
  const color = tone === "positive"
    ? "border-up/45 text-up hover:bg-up/10"
    : tone === "negative"
      ? "border-down/45 text-down hover:bg-down/10"
      : "border-edge text-dim hover:border-gold-400/50 hover:text-ink";
  return (
    <button type="button" onClick={onClick} className={`min-h-11 sm:min-h-9 rounded-md border px-3 t-label font-semibold transition ${color}`}>
      {children}
    </button>
  );
}

function Overview({ data }: { data: AdminData }) {
  const product = data.product;
  const workers = product.workers || [];
  const failed = Number(product.failedExecutions24h || 0);
  return (
    <div className="space-y-7">
      <MetricStrip items={[
        { label: "Users", value: product.users || 0 },
        { label: "Active bots", value: product.activeBots || 0, tone: "text-up" },
        { label: "Open positions", value: product.openPositions || 0 },
        { label: "Pending reviews", value: Number(data.summary.pendingChannels || 0) + Number(product.pendingKolStrategies || 0) + Number(product.pendingPayouts || 0), tone: "text-gold-400" }
      ]} />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <section>
          <SectionTitle title="Operational queue" detail="Database-backed state" />
          <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
            {[
              ["Discord registrations", data.summary.pendingChannels || 0, "/register submissions awaiting approval"],
              ["KOL moderation", product.pendingKolStrategies || 0, "Strategies awaiting owner review"],
              ["Payout review", product.pendingPayouts || 0, "Execution remains disabled"],
              ["Unreconciled executions", product.unreconciledExecutions || 0, "Submitted or confirmed records"],
              ["Failed executions (24h)", failed, "Controlled execution attempts"],
              ["Dead-letter jobs", product.deadLetters || 0, "Jobs requiring operator attention"]
            ].map(([label, value, detail]) => (
              <div key={String(label)} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="t-label font-medium text-ink">{label}</p>
                  <p className="mt-0.5 t-label text-dim">{detail}</p>
                </div>
                <span className={`font-mono t-body ${Number(value) > 0 ? "text-gold-400" : "text-dim"}`}>{value}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle title="Worker health" detail={`${workers.length} leases`} />
          {workers.length ? (
            <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
              {workers.map((worker) => (
                <div key={`${worker.key}-${worker.instanceId}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono t-label text-ink">{worker.key}</p>
                    <p className="mt-1 truncate t-label text-dim">
                      {worker.executionMode || "not reported"} · {formatDate(worker.heartbeatAt)}
                    </p>
                  </div>
                  <StatusPill status={worker.healthy ? "healthy" : "degraded"} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={RadioTower} title="No active worker lease" description="No product worker has published a current lease to the operations registry." />
          )}
        </section>
      </div>
      <section>
        <SectionTitle title="Safety gates" detail="Mainnet stays off until controlled review" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {["mainnet_execution_enabled", "discord_entries_enabled", "kol_entries_enabled", "payout_processing_enabled"].map((key) => {
            const enabled = data.product.systemFlags?.[key] === true;
            return (
              <div key={key} className="rounded-md border border-edge bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <ShieldAlert size={17} className={enabled ? "text-down" : "text-up"} />
                  <StatusPill status={enabled ? "enabled" : "disabled"} />
                </div>
                <p className="mt-4 break-words t-label text-dim">{key}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ApplicationRow({ app, act }: { app: Application; act: (action: AdminAction) => void }) {
  const inviteUrl = safeDiscordInvite(app.invite_link);
  return (
    <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1.2fr_1fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">{app.server_name}</p>
          <StatusPill status={app.status} />
        </div>
        <p className="mt-1 truncate t-label text-dim">{app.owner_handle} · {app.member_count || "Unknown"} members</p>
      </div>
      <p className="line-clamp-2 t-label leading-5 text-dim">{app.pitch || "No application note supplied."}</p>
      <div className="flex flex-wrap gap-2">
        {inviteUrl && (
          <a href={inviteUrl} target="_blank" rel="noreferrer" className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim hover:text-ink" aria-label={`Open ${app.server_name} invite`}>
            <ExternalLink size={14} />
          </a>
        )}
        {app.status === "pending" && (
          <>
            <ActionButton tone="positive" onClick={() => act({
              title: "Approve server application",
              description: `Approve ${app.server_name} as a Discord source applicant.`,
              endpoint: "/api/admin/applications",
              body: { id: app.id, action: "approve" },
              reasonRequired: true
            })}>Approve</ActionButton>
            <ActionButton tone="negative" onClick={() => act({
              title: "Reject server application",
              description: `Reject ${app.server_name}. The decision is preserved in the audit log.`,
              endpoint: "/api/admin/applications",
              body: { id: app.id, action: "reject" },
              destructive: true,
              reasonRequired: true
            })}>Reject</ActionButton>
          </>
        )}
      </div>
    </div>
  );
}

function ChannelRow({ channel, act }: { channel: Channel; act: (action: AdminAction) => void }) {
  const name = `${channel.guild_name || "Discord server"} #${channel.channel_name || channel.channel_id}`;
  const sourceAction = (action: "suspend" | "reactivate" | "remove" | "reapprove", destructive = false) => act({
    title: `${action[0].toUpperCase()}${action.slice(1)} Discord source`,
    description: `${action[0].toUpperCase()}${action.slice(1)} ${name}. Existing financial history is preserved.`,
    endpoint: "/api/admin/sources",
    body: { sourceGroupId: channel.group_id, action },
    destructive,
    reasonRequired: true
  });
  return (
    <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1.3fr_.8fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-ink">{name}</p>
          <StatusPill status={channel.status} />
        </div>
        <p className="mt-1 truncate t-label text-dim">
          {channel.channel_id} · {channel.guild_member_count ?? "Unknown"} members · by {channel.registered_by || "Unknown"}
        </p>
        {channel.group_id && (
          <p className="mt-1 truncate t-label text-dim">
            Profile {channel.integration_health || "pending"} · {channel.profile_synced_at ? `synced ${formatDate(channel.profile_synced_at)}` : "awaiting sync"}
          </p>
        )}
        {channel.profile_sync_error && <p className="mt-1 line-clamp-2 t-label text-down">{channel.profile_sync_error}</p>}
      </div>
      <p className="t-label text-dim">{channel.decision_reason || `Registered ${formatDate(channel.created_at)}`}</p>
      <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
        {channel.status === "pending" && (
          <>
            <ActionButton tone="positive" onClick={() => act({
              title: "Approve registered channel",
              description: `Approve ${name} and publish its source record.`,
              endpoint: "/api/admin/channels",
              body: { id: channel.id, action: "approve" },
              reasonRequired: true
            })}>Approve</ActionButton>
            <ActionButton tone="negative" onClick={() => act({
              title: "Reject registered channel",
              description: `Reject the /register submission for ${name}.`,
              endpoint: "/api/admin/channels",
              body: { id: channel.id, action: "reject" },
              destructive: true,
              reasonRequired: true
            })}>Reject</ActionButton>
          </>
        )}
        {channel.group_id && channel.status === "approved" && (
          <>
            <ActionButton onClick={() => sourceAction("suspend", true)}>Suspend</ActionButton>
            <ActionButton tone="negative" onClick={() => sourceAction("remove", true)}>Remove</ActionButton>
          </>
        )}
        {channel.group_id && channel.status === "suspended" && <ActionButton tone="positive" onClick={() => sourceAction("reactivate")}>Reactivate</ActionButton>}
        {channel.group_id && channel.status === "removed" && <ActionButton tone="positive" onClick={() => sourceAction("reapprove")}>Reapprove</ActionButton>}
      </div>
    </div>
  );
}

function Discord({ data, act }: { data: AdminData; act: (action: AdminAction) => void }) {
  const pending = data.channels.filter((channel) => channel.status === "pending").length;
  return (
    <div className="space-y-7">
      <MetricStrip items={[
        { label: "Pending /register", value: pending, tone: pending ? "text-gold-400" : "text-ink" },
        { label: "Approved channels", value: data.channels.filter((item) => item.status === "approved").length, tone: "text-up" },
        { label: "Server applications", value: data.applications.length },
        {
          label: "Bot runtime",
          value: data.botConfig.live?.online ? "Online" : "Offline",
          tone: data.botConfig.live?.online ? "text-up" : "text-down"
        }
      ]} />
      <section className="overflow-hidden rounded-md border border-edge bg-panel">
        <header className="border-b border-edge px-4 py-4">
          <h2 className="t-body font-semibold text-ink">Verified source ownership</h2>
          <p className="mt-1 t-label text-dim">Discord identity, current owner, commission rate, and immutable link history.</p>
        </header>
        {data.discordOwnership.sources.length === 0 ? (
          <p className="px-4 py-8 text-center t-label text-dim">No Discord source ownership records yet.</p>
        ) : (
          <div className="divide-y divide-edge">
            {data.discordOwnership.sources.map((source) => (
              <div key={source.sourceGroupId} className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_1fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate t-label font-semibold text-ink">{source.sourceName}</p><StatusPill status={source.ownerPrivyUserId ? "verified owner" : "unclaimed"} /></div>
                  <p className="mt-1 truncate ui-code t-label text-dim">Guild {source.discordGuildId} · Discord {source.discordUserId || "not linked"}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate t-label text-ink">{source.ownerPrivyUserId || "No account owner"}</p>
                  <p className="mt-1 t-label text-dim">{(source.commissionRateBps / 100).toFixed(2)}% · {source.validFrom ? `linked ${formatDate(source.validFrom)}` : "no current ownership period"}</p>
                </div>
                {source.ownerPrivyUserId && <ActionButton tone="negative" onClick={() => act({
                  title: "Revoke Discord source ownership",
                  description: `Remove the current owner from ${source.sourceName}. Earned balances remain immutable; only future creator allocation stops.`,
                  endpoint: "/api/admin/sources/ownership",
                  body: { sourceGroupId: source.sourceGroupId, action: "revoke" },
                  destructive: true,
                  reasonRequired: true
                })}>Revoke owner</ActionButton>}
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-px border-t border-edge bg-edge sm:grid-cols-2">
          <div className="bg-panel p-4"><p className="field-label">Link sessions</p><p className="mt-2 font-mono t-body text-ink">{data.discordOwnership.sessions.length}</p></div>
          <div className="bg-panel p-4"><p className="field-label">Ownership events</p><p className="mt-2 font-mono t-body text-ink">{data.discordOwnership.events.length}</p></div>
        </div>
      </section>
      <div className="rounded-md border border-edge bg-panel px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="t-label font-semibold text-ink">Discord application {data.botConfig.clientId || "not reported"}</p>
            <p className="mt-1 t-label text-dim">
              {data.botConfig.registrationCommand || "/register"} · {data.botConfig.live?.version || data.botConfig.botBuild || "build unknown"} · {data.botConfig.live?.guilds ?? "?"} guilds
            </p>
          </div>
          <StatusPill status={
            data.botConfig.live?.online &&
            data.botConfig.live?.commandsRegistered &&
            data.botConfig.live?.approvedChannelRefreshOk
              ? "ready"
              : "degraded"
          } />
        </div>
        <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-3">
          <div className="bg-base px-3 py-2">
            <p className="field-label">Commands</p>
            <p className={`mt-1 t-label font-semibold ${data.botConfig.live?.commandsRegistered ? "text-up" : "text-down"}`}>
              {data.botConfig.live?.commandsRegistered ? "Registered" : "Needs sync"}
            </p>
          </div>
          <div className="bg-base px-3 py-2">
            <p className="field-label">Approved registry</p>
            <p className={`mt-1 t-label font-semibold ${data.botConfig.live?.approvedChannelRefreshOk ? "text-up" : "text-down"}`}>
              {data.botConfig.live?.approvedChannelRefreshOk ? "Synced" : "Degraded"}
            </p>
          </div>
          <div className="bg-base px-3 py-2">
            <p className="field-label">/register outcomes</p>
            <p className="mt-1 font-mono t-label text-ink">
              {data.botConfig.live?.registrationSucceeded ?? 0} ok · {data.botConfig.live?.registrationFailed ?? 0} failed
            </p>
          </div>
        </div>
      </div>
      <section>
        <SectionTitle title="Registered call channels" detail={`${data.channels.length} total`} />
        {data.channels.length ? (
          <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
            {data.channels.map((channel) => <ChannelRow key={channel.id} channel={channel} act={act} />)}
          </div>
        ) : (
          <EmptyState icon={Bot} title="No channel registrations" description="A successful /register command will create a pending row here immediately." />
        )}
      </section>
      <section>
        <SectionTitle title="Server applications" detail={`${data.applications.length} total`} />
        {data.applications.length ? (
          <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
            {data.applications.map((app) => <ApplicationRow key={app.id} app={app} act={act} />)}
          </div>
        ) : (
          <EmptyState icon={Users} title="No server applications" description="Discord source applications submitted through Affiliate will appear here." />
        )}
      </section>
    </div>
  );
}

function Kol({ data, act }: { data: AdminData; act: (action: AdminAction) => void }) {
  const moderate = (strategy: KolStrategy, action: "approve" | "reject" | "suspend" | "request-changes", destructive = false) => act({
    title: `${action.replace("-", " ")} KOL strategy`,
    description: `${action.replace("-", " ")} ${strategy.name}. Subscribers and future marketplace visibility follow this decision.`,
    endpoint: "/api/admin/kol-strategies",
    body: { strategyId: strategy.id, action },
    destructive,
    reasonRequired: true
  });
  return (
    <section>
      <SectionTitle title="KOL strategy moderation" detail="Creator fee fixed at 20 bps" />
      {data.strategies.length ? (
        <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
          {data.strategies.map((strategy) => (
            <div key={strategy.id} className="grid gap-4 px-4 py-4 xl:grid-cols-[1.1fr_.7fr_.7fr_auto] xl:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-ink">{strategy.name}</p>
                  <StatusPill status={strategy.moderationStatus} />
                </div>
                <p className="mt-1 truncate t-label text-dim">{strategy.description || "No public strategy description."}</p>
              </div>
              <div className="t-label text-dim">
                <p>Risk: <span className="text-ink">{strategy.riskTier}</span></p>
                <p className="mt-1">Version: <span className="text-ink">{strategy.version || 1}</span></p>
              </div>
              <div className="t-label text-dim">
                <p>Fee: <span className="text-ink">{strategy.creatorFeeBps} bps</span></p>
                <p className="mt-1">Updated: <span className="text-ink">{formatDate(strategy.updated_at)}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                {strategy.moderationStatus === "pending" && (
                  <>
                    <ActionButton tone="positive" onClick={() => moderate(strategy, "approve")}>Approve</ActionButton>
                    <ActionButton onClick={() => moderate(strategy, "request-changes")}>Changes</ActionButton>
                    <ActionButton tone="negative" onClick={() => moderate(strategy, "reject", true)}>Reject</ActionButton>
                  </>
                )}
                {strategy.moderationStatus === "approved" && <ActionButton tone="negative" onClick={() => moderate(strategy, "suspend", true)}>Suspend</ActionButton>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Bot} title="No KOL strategies" description="Published and pending creator strategies will appear here for moderation." />
      )}
    </section>
  );
}

function ReferralRow({ referral }: { referral: ReferralAttribution }) {
  const openFlags = referral.flags.filter((flag) => flag.status === "open");
  return (
    <div className="grid gap-4 px-4 py-4 xl:grid-cols-[1fr_.8fr_.75fr_.7fr] xl:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono t-label font-semibold text-ink">/{referral.code}</p>
          <StatusPill status={referral.status} />
        </div>
        <p className="mt-1 truncate t-label text-dim">{referral.statusReason}</p>
      </div>
      <div className="min-w-0 t-label text-dim">
        <p className="truncate">From <span className="text-ink">{compact(referral.referrerPrivyUserId, 10, 6)}</span></p>
        <p className="mt-1 truncate">To <span className="text-ink">{compact(referral.referredPrivyUserId, 10, 6)}</span></p>
      </div>
      <div className="t-label text-dim">
        <p>Captured <span className="text-ink">{formatDate(referral.attributed_at)}</span></p>
        <p className="mt-1">Qualified <span className={referral.firstQualifyingAt ? "text-up" : "text-dim"}>{formatDate(referral.firstQualifyingAt || undefined)}</span></p>
      </div>
      <div className="t-label text-dim">
        <p>Reward <span className="float-right text-ink">{formatSol(referral.rewardLamports)}</span></p>
        <p className="mt-1">
          Flags
          <span className={`float-right ${openFlags.length ? "text-down" : "text-up"}`}>
            {openFlags.length ? `${openFlags.length} open` : "clear"}
          </span>
        </p>
      </div>
      {openFlags.length > 0 && (
        <div className="rounded-md border border-down/30 bg-down/5 px-3 py-2 xl:col-span-4">
          {openFlags.map((flag) => (
            <p key={flag.id} className="t-label leading-5 text-down">
              {flag.severity.toUpperCase()} · {flag.type.replaceAll("_", " ")} · {flag.reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Referrals({ data }: { data: AdminData }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? data.referrals.filter((referral) => [
      referral.code,
      referral.status,
      referral.statusReason,
      referral.referrerPrivyUserId,
      referral.referredPrivyUserId
    ].some((value) => value.toLowerCase().includes(needle)))
    : data.referrals;
  const reviewCount = data.referrals.filter((referral) => referral.status === "review").length;
  const qualifiedCount = data.referrals.filter((referral) => referral.firstQualifyingAt).length;
  const openFlags = data.referrals.reduce(
    (total, referral) => total + referral.flags.filter((flag) => flag.status === "open").length,
    0
  );

  return (
    <div className="space-y-6">
      <MetricStrip items={[
        { label: "Attributions", value: data.referrals.length },
        { label: "Qualified users", value: qualifiedCount, tone: "text-up" },
        { label: "Needs review", value: reviewCount, tone: reviewCount ? "text-gold-400" : "text-ink" },
        { label: "Open abuse flags", value: openFlags, tone: openFlags ? "text-down" : "text-up" }
      ]} />
      <div className="rounded-md border border-gold-400/35 bg-gold-400/5 px-4 py-3">
        <p className="t-label font-semibold text-gold-400">Referral rewards are not enabled</p>
        <p className="mt-1 t-label leading-5 text-dim">
          Attribution and qualifying activity are recorded, but no monetary reward accrues until an audited reward policy is approved and enabled.
        </p>
      </div>
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="Referral attribution review" detail={`${rows.length} shown`} />
          <label className="relative w-full sm:w-72">
            <span className="sr-only">Search referrals</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="field-control min-h-11 sm:min-h-10 w-full pl-9"
              placeholder="Search code, status, or user"
            />
          </label>
        </div>
        {rows.length ? (
          <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
            {rows.map((referral) => <ReferralRow key={referral.id} referral={referral} />)}
          </div>
        ) : (
          <EmptyState
            icon={Link2}
            title={data.referrals.length ? "No matching referrals" : "No referral attributions"}
            description={data.referrals.length ? "Change the search to review another attribution." : "A signed first-touch referral will appear here after the invited user authenticates."}
          />
        )}
      </section>
    </div>
  );
}

function nextPayoutActions(payout: Payout, processingEnabled: boolean) {
  if (payout.status === "requested") return ["review", "approve", "reject"] as const;
  if (payout.status === "reviewing") return ["approve", "reject"] as const;
  if (payout.status === "approved") return processingEnabled ? ["processing", "reject"] as const : ["reject"] as const;
  if (payout.status === "processing") return processingEnabled ? ["confirm", "fail"] as const : [] as const;
  return [] as const;
}

function Payouts({ data, act }: { data: AdminData; act: (action: AdminAction) => void }) {
  const processingEnabled = data.product.systemFlags?.payout_processing_enabled === true;
  const requestAction = (payout: Payout, action: string) => act({
    title: `${action} payout request`,
    description: action === "confirm"
      ? `Record the confirmed treasury transfer of ${formatSol(payout.netLamports)} to ${compact(payout.destinationWallet)}. The signature is immutable once saved.`
      : action === "processing"
        ? `Reserve ${formatSol(payout.netLamports)} for the treasury transfer to ${compact(payout.destinationWallet)}. Send the transfer, then confirm it with its signature.`
        : `${action} ${formatSol(payout.grossLamports)} for ${compact(payout.destinationWallet)}.`,
    endpoint: "/api/admin/payouts",
    body: { payoutId: payout.id, action },
    destructive: action === "reject" || action === "fail",
    reasonRequired: true,
    ...(action === "confirm" ? {
      input: {
        key: "txSignature",
        label: "Confirmed Solana transaction signature",
        placeholder: "Paste the treasury transfer signature",
        required: true,
        pattern: "^[1-9A-HJ-NP-Za-km-z]{64,120}$"
      }
    } : {})
  });
  return (
    <div className="space-y-6">
      <div className={`rounded-md border px-4 py-3 ${processingEnabled ? "border-up/35 bg-up/5" : "border-gold-400/35 bg-gold-400/5"}`}>
        <p className={`t-label font-semibold ${processingEnabled ? "text-up" : "text-gold-400"}`}>
          {processingEnabled ? "Payout settlement is available" : "Payout settlement gate is off"}
        </p>
        <p className="mt-1 t-label leading-5 text-dim">
          {processingEnabled
            ? "Approved requests can enter processing and are confirmed only with an on-chain transaction signature."
            : "Requests can still be reviewed and approved. Enable the audited payout gate after the treasury signer is ready."}
        </p>
      </div>
      <section>
        <SectionTitle title="Creator payout requests" detail="0.1 SOL minimum · 0.043 SOL processing fee" />
        {data.payouts.length ? (
          <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
            {data.payouts.map((payout) => (
              <div key={payout.id} className="grid gap-4 px-4 py-4 xl:grid-cols-[1fr_.8fr_.8fr_auto] xl:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono t-label text-ink">{compact(payout.id, 8, 6)}</p>
                    <StatusPill status={payout.status} />
                  </div>
                  <p className="mt-1 t-label text-dim">{compact(payout.destinationWallet, 8, 6)}</p>
                </div>
                <div className="t-label text-dim">
                  <p>Gross <span className="float-right text-ink">{formatSol(payout.grossLamports)}</span></p>
                  <p className="mt-1">Fee <span className="float-right text-gold-400">{formatSol(payout.processingFeeLamports)}</span></p>
                </div>
                <div className="t-label text-dim">
                  <p>Net <span className="float-right text-up">{formatSol(payout.netLamports)}</span></p>
                  <p className="mt-1">Requested <span className="float-right text-ink">{formatDate(payout.requested_at)}</span></p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {nextPayoutActions(payout, processingEnabled).map((action) => (
                    <ActionButton key={action} tone={action === "approve" ? "positive" : action === "reject" ? "negative" : "neutral"} onClick={() => requestAction(payout, action)}>
                      {action[0].toUpperCase()}{action.slice(1)}
                    </ActionButton>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={WalletCards} title="No payout requests" description="Creator withdrawal requests backed by the commission ledger will appear here." />
        )}
      </section>
    </div>
  );
}

function Operations({ data }: { data: AdminData }) {
  const scanner = data.scanner;
  return (
    <div className="space-y-7">
      <MetricStrip items={[
        { label: "Scanner tokens", value: scanner.tokenCount || 0 },
        { label: "Scanner pools", value: scanner.poolCount || 0 },
        { label: "Unsupported pools", value: scanner.unsupportedPools || 0, tone: Number(scanner.unsupportedPools || 0) ? "text-gold-400" : "text-ink" },
        { label: "Quarantined signals (24h)", value: scanner.quarantinedSignals24h || 0, tone: Number(scanner.quarantinedSignals24h || 0) ? "text-gold-400" : "text-ink" }
      ]} />
      <section>
        <SectionTitle title="Scanner freshness" detail={scanner.status || (scanner.ok ? "healthy" : "not reporting")} />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-edge bg-panel p-4">
            <Activity size={17} className="text-up" />
            <p className="ui-label mt-4">Latest market snapshot</p>
            <p className="mt-2 t-body text-ink">{formatDate(scanner.latestMarketSnapshotAt)}</p>
          </div>
          <div className="rounded-md border border-edge bg-panel p-4">
            <ShieldAlert size={17} className="text-gold-400" />
            <p className="ui-label mt-4">Latest risk snapshot</p>
            <p className="mt-2 t-body text-ink">{formatDate(scanner.latestRiskSnapshotAt)}</p>
          </div>
        </div>
      </section>
      <section>
        <SectionTitle title="Trade executions" detail={`${data.executions.length} recent records`} />
        {data.executions.length ? (
          <div className="overflow-x-auto rounded-md border border-edge bg-panel">
            <table className="w-full min-w-[920px] text-left">
              <thead className="ui-label border-b border-edge bg-void/60">
                <tr><th className="px-4 py-3">Status</th><th>Side / mint</th><th>Mode</th><th>Notional</th><th>Fees</th><th>Created</th></tr>
              </thead>
              <tbody className="divide-y divide-edge t-label">
                {data.executions.map((execution) => (
                  <tr key={execution.id}>
                    <td className="px-4 py-3"><StatusPill status={execution.status} /></td>
                    <td><span className={execution.side === "buy" ? "text-up" : "text-down"}>{execution.side.toUpperCase()}</span> <span className="ml-2 font-mono text-dim">{compact(execution.mint)}</span></td>
                    <td className="font-mono text-dim">{execution.executionMode}</td>
                    <td className="font-mono text-ink">{formatSol(execution.grossNotionalLamports)}</td>
                    <td className="font-mono text-dim">{formatSol(Number(execution.platformFeeLamports || 0) + Number(execution.creatorFeeLamports || 0))}</td>
                    <td className="pr-4 t-label text-dim">{formatDate(execution.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Activity} title="No execution records" description="Controlled execution attempts will be listed here with reconciliation state." />
        )}
      </section>
    </div>
  );
}

function UserList({ data }: { data: AdminData }) {
  return (
    <section>
      <SectionTitle title="Users and verified identities" detail={`${data.users.length} accounts`} />
      {data.users.length ? (
        <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
          {data.users.map((user) => (
            <div key={user.privyUserId} className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_1fr_.6fr] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-ink">{user.displayName || compact(user.privyUserId, 10, 6)}</p>
                  <StatusPill status={user.status} />
                </div>
                <p className="mt-1 t-label text-dim">{user.roles.join(", ") || "USER"}</p>
              </div>
              <div className="min-w-0 t-label text-dim">
                {user.identities.map((identity) => (
                  <p key={`${user.privyUserId}-${identity.provider}`} className="truncate">
                    {identity.provider}: <span className="text-ink">{identity.email || (identity.emailVerified ? "verified" : "linked")}</span>
                  </p>
                ))}
                {!user.identities.length && <p>No verified identity</p>}
              </div>
              <div className="t-label text-dim">
                <p>{user.botCount} bots · {user.wallets.length} wallets</p>
                <p className="mt-1">{formatDate(user.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Users} title="No synchronized users" description="A user record is created after a verified Privy identity reaches the server API." />
      )}
    </section>
  );
}

/**
 * Whether the platform fee can actually be collected, and the exact account that has to exist.
 *
 * `feeWalletConfigured` only ever said the environment variable was non-empty, which is how a
 * 2.00% preview coexisted with a 0 bps charge for weeks: the configured value is a WALLET, and
 * Jupiter needs a token account for the mint the fee arrives in. This names the derived
 * account per mint so the owner can create it, rather than leaving "create the right fee
 * account" as an instruction nobody can act on.
 */
type PhantomFeeProvider = {
  isPhantom?: boolean;
  connect: () => Promise<unknown>;
  publicKey?: { toBase58: () => string } | null;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature?: string }>;
};

function FeeAccountPanel({ data, fetchJson }: {
  data: AdminData;
  fetchJson: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const fee = (data.summary as Record<string, any>)?.feeAccount;
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  if (!fee) return null;

  async function createWsolAccount() {
    setCreating(true);
    setResult(null);
    try {
      const provider = (window as unknown as { solana?: PhantomFeeProvider }).solana;
      if (!provider?.isPhantom) throw new Error("Open Phantom with a wallet that can pay the one-time account rent.");
      await provider.connect();
      const payer = provider.publicKey?.toBase58();
      if (!payer) throw new Error("Connect a Phantom wallet to pay the one-time account rent.");
      const payload = await fetchJson<{ transaction: string; account: string }>("/api/admin/fee-account", {
        method: "POST",
        body: JSON.stringify({ payer })
      });
      const web3 = await import("@solana/web3.js");
      const transaction = web3.Transaction.from(Uint8Array.from(atob(payload.transaction), (char) => char.charCodeAt(0)));
      const sent = await provider.signAndSendTransaction(transaction);
      setResult(`Fee account transaction sent: ${sent.signature || "submitted"}`);
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : "Fee account creation failed");
    } finally {
      setCreating(false);
    }
  }

  if (!fee.configured) {
    return (
      <div className="mb-6 rounded-md border border-danger/40 bg-danger/5 px-4 py-3">
        <p className="t-label font-semibold text-ink">Platform fee is not collecting</p>
        <p className="mt-1 t-label leading-5 text-dim">
          No fee account is configured, so every swap is built with a zero fee.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-md border border-edge bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div>
          <p className="t-label font-semibold text-ink">Platform fee account</p>
          <p className="mt-0.5 t-label text-dim">{compact(fee.owner, 8, 6)}</p>
        </div>
        <StatusPill status={fee.ready ? "enabled" : "disabled"} />
      </header>
      {!fee.ready && (
        <div className="border-b border-edge px-4 py-3">
          <p className="t-label leading-5 text-dim">
            A fee is skipped whenever its account does not exist. Create the wSOL account once;
            Any wallet may pay the one-time rent; Phantom shows the amount before approval and no client funds move.
          </p>
          <button
            type="button"
            onClick={createWsolAccount}
            disabled={creating}
            className="mt-3 min-h-11 rounded-md bg-gold-400 px-4 t-label font-semibold text-[#17110c] disabled:opacity-50"
          >
            {creating ? "Preparing…" : "Create wSOL fee account"}
          </button>
          {result && <p role="status" className="mt-2 break-all t-label text-dim">{result}</p>}
        </div>
      )}
      <div className="divide-y divide-edge">
        {(fee.mints || []).map((mint: Record<string, any>) => (
          <div key={mint.mint} className="grid gap-2 px-4 py-3 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="t-label font-medium text-ink">{mint.symbol}</p>
              <p className="mt-0.5 t-label leading-4 text-dim">{mint.why}</p>
            </div>
            <p className="min-w-0 break-all t-label text-dim">
              {mint.ready ? mint.feeAccount : mint.derivedAccount || "could not derive"}
            </p>
            <StatusPill status={mint.ready ? "enabled" : "disabled"} />
          </div>
        ))}
      </div>
    </div>
  );
}

function System({ data, act, fetchJson }: {
  data: AdminData;
  act: (action: AdminAction) => void;
  fetchJson: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  return (
    <section>
      <FeeAccountPanel data={data} fetchJson={fetchJson} />
      <SectionTitle title="System flags" detail="Every mutation requires a reason and is audited" />
      <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
        {data.flags.map((flag) => {
          const enabled = flag.value === true;
          const protectedGate = ["mainnet_execution_enabled", "payout_processing_enabled"].includes(flag.flag_key);
          return (
            <div key={flag.flag_key} className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_.8fr_auto] lg:items-center">
              <div className="min-w-0">
                <p className="break-words font-mono t-label text-ink">{flag.flag_key}</p>
                <p className="mt-1 t-label leading-5 text-dim">{flag.description || "No description provided."}</p>
              </div>
              <p className="t-label text-dim">
                Updated {formatDate(flag.updated_at)}{flag.updated_by ? ` by ${compact(flag.updated_by, 8, 5)}` : ""}
              </p>
              <div className="flex items-center gap-3">
                <StatusPill status={enabled ? "enabled" : "disabled"} />
                <button
                  type="button"
                  disabled={protectedGate && !enabled}
                  onClick={() => act({
                    title: `${enabled ? "Disable" : "Enable"} system flag`,
                    description: `${enabled ? "Disable" : "Enable"} ${flag.flag_key}.`,
                    endpoint: "/api/admin/system",
                    method: "PATCH",
                    body: { flagKey: flag.flag_key, value: !enabled },
                    destructive: enabled || protectedGate,
                    reasonRequired: true
                  })}
                  className="relative h-7 w-12 rounded-full border border-edge bg-void disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`${enabled ? "Disable" : "Enable"} ${flag.flag_key}`}
                  title={protectedGate && !enabled ? "Requires controlled deployment review" : undefined}
                >
                  <span className={`absolute top-1 h-[18px] w-[18px] rounded-full transition ${enabled ? "left-6 bg-up" : "left-1 bg-dim"}`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!data.flags.length && <EmptyState icon={ShieldAlert} title="No system flags returned" description="The owner API did not return the runtime feature-gate registry." />}
    </section>
  );
}

function Audit({ data }: { data: AdminData }) {
  return (
    <section>
      <SectionTitle title="Immutable admin audit log" detail={`${data.events.length} recent events`} />
      {data.events.length ? (
        <div className="divide-y divide-edge rounded-md border border-edge bg-panel">
          {data.events.map((event) => (
            <div key={event.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[.8fr_1fr_.9fr]">
              <div>
                <p className="font-mono t-label text-ink">{event.action}</p>
                <p className="mt-1 t-label text-dim">{formatDate(event.created_at)}</p>
              </div>
              <div>
                <p className="t-label text-ink">{event.targetType}</p>
                <p className="mt-1 truncate t-label text-dim">{event.targetId}</p>
              </div>
              <div>
                <p className="line-clamp-2 t-label text-dim">{event.reason || "No reason supplied for this historical event."}</p>
                {event.correlationId && <p className="mt-1 truncate ui-code t-label text-dim">Correlation {event.correlationId}</p>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={CheckCircle2} title="No audit events" description="Privileged product mutations will be preserved here with actor, reason, and correlation data." />
      )}
    </section>
  );
}

export default function OwnerSections({
  active,
  data,
  act,
  fetchJson
}: {
  active: AdminTab;
  data: AdminData;
  act: (action: AdminAction) => void;
  fetchJson: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  if (active === "overview") return <Overview data={data} />;
  if (active === "discord") return <Discord data={data} act={act} />;
  if (active === "kol") return <Kol data={data} act={act} />;
  if (active === "referrals") return <Referrals data={data} />;
  if (active === "payouts") return <Payouts data={data} act={act} />;
  if (active === "operations") return <Operations data={data} />;
  if (active === "users") return <UserList data={data} />;
  if (active === "system") return <System data={data} act={act} fetchJson={fetchJson} />;
  if (active === "audit") return <Audit data={data} />;
  return <EmptyState icon={CircleAlert} title="Unknown admin view" description="Choose an owner-console section." />;
}
