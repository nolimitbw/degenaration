import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, BarChart3, ExternalLink, MessageCircle, RadioTower, ShieldCheck } from "lucide-react";
import AppShell from "@/components/AppShell";
import CopyReferralLink from "@/components/CopyReferralLink";
import { DiscordSourceAvatar, IntegrationHealthDot } from "@/components/product/DiscordSourceVisual";
import { StatusPill } from "@/components/product/Primitives";
import { getPublicSource } from "@/lib/publicSource";

type Props = { params: Promise<{ slug: string }> };

const metric = (value: number | null, digits = 1) => value == null ? "Pending" : `${value.toFixed(digits)}x`;

/**
 * The price a call was made at, in the smallest form that stays readable.
 *
 * Memecoin prices routinely sit below a cent, and `toFixed(2)` renders every one of them as
 * "$0.00" — a number that looks recorded and says nothing. Below a cent this switches to
 * significant digits so 0.00002341 reads as itself.
 */
const usd = (value: number | null) => {
  if (value == null) return "Collecting data";
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(3)}`;
};

/** Market cap and liquidity, which are always large enough for compact notation. */
const compactUsd = (value: number | null) =>
  value == null ? "Collecting data" : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
const safeDiscordInvite = (value: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.protocol === "https:" && (url.hostname === "discord.gg" || url.hostname === "discord.com") ? url.toString() : null;
  } catch { return null; }
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const source = await getPublicSource((await params).slug);
  if (!source) return { title: "Source not found" };
  return {
    title: `${source.name} performance`,
    description: `Verified Discord call performance for ${source.name}: ${source.metrics.calls} recorded calls on Degenaration.`
  };
}

export default async function SourceProfile({ params }: Props) {
  const source = await getPublicSource((await params).slug);
  if (!source) notFound();
  const invite = safeDiscordInvite(source.discordInviteUrl);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl">
        <section className="overflow-hidden rounded-md border border-edge bg-panel">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <DiscordSourceAvatar source={source} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-bold sm:text-3xl">{source.name}</h1>
                  <BadgeCheck aria-label="Approved source" size={19} className="text-gold-400" />
                  <IntegrationHealthDot status={source.integrationHealth} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-dim">
                  <span>{source.members ? `${source.members} members` : "Member count pending"}</span>
                  <span>{source.tag || "Discord source"}</span>
                  <span>Tracking since {new Date(source.createdAt).toLocaleDateString("en", { month: "short", year: "numeric" })}</span>
                </p>
                {source.ownerDisplayName && <p className="mt-2 text-xs text-dim">Managed by {source.ownerDisplayName}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {invite && (
                <a href={invite} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#031018] transition hover:brightness-110">
                  <MessageCircle aria-hidden="true" size={17} /> Join Discord <ExternalLink aria-hidden="true" size={14} />
                </a>
              )}
              <Link href={`/bots/discord/new?source=${source.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink transition hover:border-gold-400/60">
                <RadioTower aria-hidden="true" size={17} /> Configure bot
              </Link>
            </div>
          </div>
        </section>

        {source.bio && <p className="mt-5 max-w-3xl text-sm leading-6 text-dim">{source.bio}</p>}

        <section aria-labelledby="performance-heading" className="mt-6">
          <div className="flex items-center gap-2">
            <BarChart3 aria-hidden="true" size={18} className="text-gold-400" />
            <h2 id="performance-heading" className="text-sm font-bold">All-time recorded performance</h2>
          </div>
          <div className="mt-3 grid overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Recorded calls" value={String(source.metrics.calls)} detail={`${source.metrics.measuredCalls} measured`} />
            <Stat label="2x hit rate" value={source.metrics.hitRate == null ? "Pending" : `${source.metrics.hitRate.toFixed(0)}%`} detail="Measured calls reaching 2.00x" />
            <Stat label="Average peak" value={metric(source.metrics.avgPeakX, 2)} detail={`Median ${metric(source.metrics.medianPeakX, 2)}`} />
            <Stat label="Best call" value={metric(source.metrics.bestPeakX, 2)} detail="Peak from recorded entry" accent />
          </div>
          <p className="mt-2 flex items-start gap-2 text-[12px] leading-5 text-dim">
            <ShieldCheck aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-info" />
            Metrics are calculated from calls recorded after approval. Unmeasured calls stay visible and never count as wins.
          </p>
        </section>

        <section className="mt-7 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <h2 className="text-sm font-bold">Latest calls</h2>
            <div className="mt-3 overflow-x-auto rounded-md border border-edge">
              {source.recentCalls.length ? (
                <table className="w-full min-w-[980px] text-left">
                  <thead className="ui-label bg-panel">
                    <tr><th className="px-4 py-3">Token</th><th className="px-4 py-3">Caller</th><th className="px-4 py-3">Called</th><th className="px-4 py-3">Call price</th><th className="px-4 py-3">Market cap</th><th className="px-4 py-3">Liquidity</th><th className="px-4 py-3">Current</th><th className="px-4 py-3">Peak</th><th className="px-4 py-3">Report</th></tr>
                  </thead>
                  <tbody>
                    {source.recentCalls.map((call) => (
                      <tr key={call.id} className="border-t border-edge font-mono text-xs">
                        <td className="px-4 py-3 font-bold text-ink">{call.symbol || call.mint?.slice(0, 8) || "Unknown"}</td>
                        <td className="px-4 py-3 text-dim">{call.caller || "Channel call"}</td>
                        <td className="px-4 py-3 text-dim">{call.calledAt ? new Date(call.calledAt).toLocaleDateString() : "-"}</td>
                        {/* The immutable call-time snapshot, never recomputed. An absent figure
                            says "Collecting data" rather than $0.00, which would read as a
                            recorded price of nothing. */}
                        <td className="px-4 py-3 tabular-nums text-ink">{usd(call.calledPriceUsd)}</td>
                        <td className="px-4 py-3 tabular-nums text-dim">{compactUsd(call.calledMcapUsd)}</td>
                        <td className="px-4 py-3 tabular-nums text-dim">{compactUsd(call.calledLiquidityUsd)}</td>
                        <td className="px-4 py-3">{metric(call.currentX, 2)}</td>
                        <td className="px-4 py-3 font-bold text-up">{metric(call.peakX, 2)}</td>
                        {/* The row's only action. It measured 16px tall at 390px — a third of the minimum —
                            which the audit caught once it was pointed at a real slug rather than
                            one that 404'd. The link is inline text, so the hit area grows
                            without changing how the row reads. */}
                        <td className="px-4 py-3">{call.mint ? <Link href={`/risk/${call.mint}`} className="inline-flex min-h-11 items-center text-gold-400 hover:underline sm:min-h-0">Risk report</Link> : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="grid min-h-48 place-items-center bg-panel/30 px-5 text-center">
                  <div><p className="text-sm font-semibold text-ink">No calls recorded yet</p><p className="mt-1 max-w-sm text-[12px] leading-5 text-dim">This approved source starts with a clean record. Calls appear here only after the bot observes them in an approved channel.</p></div>
                </div>
              )}
            </div>
          </div>

          <aside className="h-fit rounded-md border border-edge bg-panel p-5">
            <p className="ui-label">Profile freshness</p>
            <p className="mt-2 text-xs text-ink">{source.profileSyncedAt ? new Date(source.profileSyncedAt).toLocaleString() : "Awaiting first Discord metadata sync"}</p>
            <div className="my-4 border-t border-edge" />
            <p className="ui-label">Server referral</p>
            <p className="mt-2 break-all font-mono text-sm text-ink">/r/{source.referralCode}</p>
            <p className="mt-2 text-xs leading-5 text-dim">A stable public link assigned to this Discord server. It opens this profile without requiring a wallet.</p>
            <div className="mt-4"><CopyReferralLink path={`/r/${source.referralCode}`} /></div>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <div className="bg-panel p-4 sm:border-r sm:border-edge sm:last:border-r-0">
      <p className="ui-label">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent ? "text-gold-400" : "text-ink"}`}>{value}</p>
      <p className="mt-1 text-[12px] text-dim">{detail}</p>
    </div>
  );
}
