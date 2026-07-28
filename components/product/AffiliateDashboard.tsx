"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  ArrowUpRight,
  Bot,
  Check,
  Clipboard,
  Copy,
  CreditCard,
  Link2,
  Loader2,
  RadioTower,
  RefreshCw,
  WalletCards,
  X
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { PageHeader, Segmented, StatusPill } from "@/components/product/Primitives";
import { formatSol, formatWhen, lamportsToSol, productFetch, solToLamports, type ProductBot } from "@/lib/product-api";
import { emailFromPrivyUser } from "@/lib/admin";
import { getSolanaAddress } from "@/lib/solanaWallet";

type Scope = "discord" | "kol" | "payouts";
type Period = "24h" | "7d" | "30d" | "3m";

type AffiliateSummary = {
  referralCode: string;
  availableLamports: number | string;
  pendingLamports: number | string;
  lifetimeLamports: number | string;
  earnings30dLamports: number | string;
  followers: number;
  volumeLamports: number | string;
  defaultRateBps: number;
  minimumPayoutLamports: number | string;
  processingFeeLamports: number | string;
  chart: Array<{ day: string; amountLamports: number | string }>;
  events: Array<any>;
  payouts: Array<any>;
  links: Array<any>;
};

export default function AffiliateDashboard({ initialScope = "discord" }: { initialScope?: Scope }) {
  const { authenticated, user, login, linkDiscord, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const toast = useToast();
  const [scope, setScope] = useState<Scope>(initialScope);
  const [period, setPeriod] = useState<Period>("30d");
  const [summary, setSummary] = useState<AffiliateSummary | null>(null);
  const [bots, setBots] = useState<ProductBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [botConfig, setBotConfig] = useState<any>(null);

  const discordLinked = Boolean((user as any)?.discord || (user as any)?.linkedAccounts?.some((account: any) => account?.type === "discord_oauth"));

  const load = useCallback(() => {
    if (!authenticated) {
      setSummary(null);
      setBots([]);
      return;
    }
    setLoading(true);
    const affiliateScope = scope === "payouts" ? "all" : scope;
    Promise.all([
      productFetch<AffiliateSummary>(`/api/product/affiliate?scope=${affiliateScope}`, { getAccessToken }),
      productFetch<{ bots: ProductBot[] }>("/api/product/bots", { getAccessToken })
    ])
      .then(([affiliate, botData]) => {
        setSummary(affiliate);
        setBots(botData.bots || []);
      })
      .catch((reason) => toast(reason instanceof Error ? reason.message : "Could not load affiliate data", "err"))
      .finally(() => setLoading(false));
  }, [authenticated, getAccessToken, scope, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/bot/config", { cache: "no-store" }).then((response) => response.json()).then(setBotConfig).catch(() => setBotConfig(null));
  }, []);

  async function copyReferral() {
    if (!summary?.referralCode) return;
    const url = `${window.location.origin}/r/${summary.referralCode}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Referral link copied");
    } catch {
      toast("Could not copy link", "err");
    }
  }

  if (!authenticated) {
    return (
      <>
        <PageHeader eyebrow="Creator revenue" title="Affiliate" description="Track Discord and KOL creator commission from confirmed, reconciled copied trades." />
        <div className="mt-6 grid min-h-72 place-items-center border border-edge bg-panel p-8 text-center">
          <div className="max-w-md">
            <WalletCards className="mx-auto text-toxic" size={26} />
            <h2 className="mt-4 text-base font-semibold text-ink">Connect your account</h2>
            <p className="mt-2 text-sm leading-6 text-dim">Commission ledgers, referral attribution, and payout requests are private account data.</p>
            <button type="button" onClick={login} className="mt-5 min-h-11 rounded-md bg-toxic px-5 text-sm font-semibold text-[#17110c]">Connect account</button>
          </div>
        </div>
      </>
    );
  }

  const filteredBots = bots.filter((bot) => bot.kind === (scope === "kol" ? "kol" : "discord"));

  return (
    <>
      <PageHeader
        eyebrow="Creator revenue"
        title="Affiliate"
        description="Immutable commission accounting for confirmed Discord and KOL copied trades. Payouts are reviewed and reconciled on chain."
        actions={
          <>
            <button type="button" onClick={load} className="grid h-10 w-10 place-items-center rounded-md border border-edge text-dim hover:text-ink" aria-label="Refresh affiliate dashboard"><RefreshCw size={15} className={loading ? "animate-spin" : ""} /></button>
            <button type="button" onClick={() => setPayoutOpen(true)} disabled={!summary || Number(summary.availableLamports) < Number(summary.minimumPayoutLamports)} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-toxic px-4 text-sm font-semibold text-[#17110c] disabled:cursor-not-allowed disabled:opacity-40"><CreditCard size={15} /> Request payout</button>
          </>
        }
      />

      <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-edge" aria-label="Affiliate sections">
        {[
          ["discord", "Discord Bot"],
          ["kol", "KOL Bot"],
          ["payouts", "Payouts"]
        ].map(([value, label]) => (
          <button key={value} type="button" onClick={() => setScope(value as Scope)} className={`relative min-h-11 shrink-0 px-4 text-sm font-medium ${scope === value ? "text-ink" : "text-dim hover:text-ink"}`}>
            {label}
            {scope === value && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-toxic" />}
          </button>
        ))}
      </nav>

      {loading && !summary && <div className="mt-6 grid min-h-72 place-items-center border border-edge bg-panel"><Loader2 className="animate-spin text-toxic" /></div>}
      {summary && scope !== "payouts" && (
        <>
          <section className="mt-5 grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Rewards available", formatSol(summary.availableLamports), "Ready for request"],
              ["Pending rewards", formatSol(summary.pendingLamports), "Awaiting availability"],
              ["Lifetime earnings", formatSol(summary.lifetimeLamports), "Positive credits"],
              ["30-day earnings", formatSol(summary.earnings30dLamports), `${summary.followers} attributed followers`]
            ].map(([label, value, detail]) => (
              <div key={label} className="bg-panel p-5">
                <p className="font-mono text-[9px] uppercase text-dim">{label}</p>
                <p className="mt-2 font-mono text-xl font-semibold text-ink">{value}</p>
                <p className="mt-1 text-[11px] text-dim">{detail}</p>
              </div>
            ))}
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="overflow-hidden rounded-md border border-edge bg-panel">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
                <div><h2 className="text-sm font-semibold text-ink">Earnings</h2><p className="mt-1 text-[11px] text-dim">Creator commission credits from authoritative ledger entries.</p></div>
                <Segmented value={period} onChange={setPeriod} label="Earnings period" options={[{ value: "24h", label: "24H" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "3m", label: "3M" }]} />
              </header>
              <AffiliateChart rows={summary.chart || []} period={period} />
              <div className="grid grid-cols-2 gap-px border-t border-edge bg-edge sm:grid-cols-4">
                <ChartMetric label="Copied volume" value={formatSol(summary.volumeLamports)} />
                <ChartMetric label="Commission rate" value={`${(summary.defaultRateBps / 100).toFixed(2)}%`} />
                <ChartMetric label="Followers" value={String(summary.followers)} />
                <ChartMetric label="Adjustments" value={String(summary.events.filter((event) => Number(event.amountLamports) < 0).length)} />
              </div>
            </section>

            <aside className="overflow-hidden rounded-md border border-edge bg-panel">
              <header className="border-b border-edge px-5 py-4"><p className="font-mono text-[9px] uppercase text-toxic">Referral link</p><h2 className="mt-2 text-sm font-semibold text-ink">Stable creator URL</h2></header>
              <div className="p-5">
                <div className="flex min-h-11 items-center gap-2 rounded-md border border-edge bg-void px-3">
                  <Link2 size={14} className="shrink-0 text-toxic" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink">{typeof window !== "undefined" ? `${window.location.origin}/r/${summary.referralCode}` : `/r/${summary.referralCode}`}</span>
                  <button type="button" onClick={copyReferral} className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-dim hover:text-ink" aria-label="Copy referral link"><Copy size={14} /></button>
                </div>
                <p className="mt-3 text-[11px] leading-5 text-dim">Attribution is stored server-side. This code does not contain your user ID, wallet, or email.</p>
                <div className="mt-4 rounded-md border border-edge bg-void p-3">
                  <p className="field-label">Signed-in creator</p>
                  <p className="mt-1.5 truncate text-xs text-ink">{emailFromPrivyUser(user) || "Privy account"}</p>
                </div>
              </div>
            </aside>
          </div>

          {scope === "discord" ? (
            <DiscordAffiliate
              linked={discordLinked}
              onLink={() => linkDiscord()}
              botConfig={botConfig}
              bots={filteredBots}
            />
          ) : (
            <KolAffiliate bots={filteredBots} summary={summary} />
          )}

          <RecentEvents events={summary.events || []} />
        </>
      )}

      {summary && scope === "payouts" && <PayoutHistory summary={summary} onRequest={() => setPayoutOpen(true)} />}
      {payoutOpen && summary && (
        <PayoutModal
          summary={summary}
          defaultWallet={getSolanaAddress(user) || ""}
          getAccessToken={getAccessToken}
          identityToken={identityToken}
          onClose={() => setPayoutOpen(false)}
          onSuccess={() => {
            setPayoutOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}

function AffiliateChart({ rows, period }: { rows: AffiliateSummary["chart"]; period: Period }) {
  const days = period === "24h" ? 1 : period === "7d" ? 7 : period === "3m" ? 90 : 30;
  const since = Date.now() - days * 86400000;
  const data = rows.filter((row) => new Date(row.day).getTime() >= since).sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());
  const values = data.map((row) => lamportsToSol(row.amountLamports));
  const max = Math.max(...values.map(Math.abs), 0.000001);
  const points = data.map((row, index) => {
    const x = data.length <= 1 ? 50 : 26 + (index / (data.length - 1)) * 508;
    const y = 128 - (lamportsToSol(row.amountLamports) / max) * 92;
    return `${x},${Math.max(22, Math.min(148, y))}`;
  }).join(" ");

  return (
    <div className="relative h-64 p-5">
      <svg viewBox="0 0 560 180" className="h-full w-full" role="img" aria-label={data.length ? `Affiliate earnings chart with ${data.length} ledger days` : "No affiliate earnings in this period"}>
        {[28, 68, 108, 148].map((y) => <line key={y} x1="20" y1={y} x2="540" y2={y} stroke="rgb(var(--edge-rgb))" strokeWidth="1" />)}
        {data.length > 1 && <polyline points={points} fill="none" stroke="rgb(var(--toxic-rgb))" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />}
        {data.map((row, index) => {
          const [x, y] = points.split(" ")[index].split(",");
          return <circle key={row.day} cx={x} cy={y} r="3.5" fill="rgb(var(--void-rgb))" stroke="rgb(var(--toxic-rgb))" strokeWidth="2" />;
        })}
      </svg>
      {data.length === 0 && <div className="absolute inset-0 grid place-items-center text-center"><div><p className="text-sm font-semibold text-ink">No earnings in this period</p><p className="mt-1 text-[11px] text-dim">Confirmed creator commission entries will appear here.</p></div></div>}
    </div>
  );
}

function ChartMetric({ label, value }: { label: string; value: string }) {
  return <div className="bg-panel p-4"><p className="field-label">{label}</p><p className="mt-2 font-mono text-sm text-ink">{value}</p></div>;
}

function DiscordAffiliate({ linked, onLink, botConfig, bots }: { linked: boolean; onLink: () => void; botConfig: any; bots: ProductBot[] }) {
  const liveReady = Boolean(
    botConfig?.live?.online &&
    botConfig?.live?.commandsRegistered &&
    botConfig?.live?.approvedChannelRefreshOk &&
    botConfig?.registrationBridgeConfigured
  );
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
        <div><h2 className="text-sm font-semibold text-ink">Discord creator setup</h2><p className="mt-1 text-[11px] text-dim">Connect ownership, install the official bot, register a channel, then submit for review.</p></div>
        <StatusPill status={linked ? "Discord connected" : "Discord not connected"} />
      </header>
      <div className="grid gap-px bg-edge lg:grid-cols-4">
        <CreatorStep number="01" title="Connect Discord" detail="Use Privy OAuth to link the account that owns or manages the server." done={linked} action={!linked ? <button type="button" onClick={onLink} className="text-xs font-semibold text-toxic">Connect Discord</button> : null} />
        <CreatorStep number="02" title="Install bot" detail="The guild install grants only the channel permissions needed for source tracking and /register." done={false} action={<a href={botConfig?.invite || "/api/bot/config"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-toxic">Add bot <ArrowUpRight size={13} /></a>} />
        <CreatorStep number="03" title="Register channel" detail="Run /register in the call channel. The bot checks your Manage Server role and its own channel access." done={false} action={<span className="font-mono text-xs text-ink">/register</span>} />
        <CreatorStep number="04" title="Submit application" detail="Add server details, invite URL, call format, and owner agreement for admin review." done={bots.length > 0} action={<Link href="/apply" className="text-xs font-semibold text-toxic">Open application</Link>} />
      </div>
      <div className="grid gap-px border-t border-edge bg-edge sm:grid-cols-4">
        <ChartMetric label="Bot runtime" value={botConfig?.live?.online ? "Online" : "Unavailable"} />
        <ChartMetric label="Slash commands" value={botConfig?.live?.commandsRegistered ? "Registered" : "Syncing"} />
        <ChartMetric label="Channel registry" value={botConfig?.live?.approvedChannelRefreshOk ? "Synced" : "Degraded"} />
        <ChartMetric label="Setup status" value={liveReady ? "Ready" : "Check status"} />
      </div>
      {!!bots.length && <div className="divide-y divide-edge border-t border-edge">{bots.map((bot) => <div key={bot.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="text-xs font-semibold text-ink">{bot.name}</p><p className="mt-1 font-mono text-[9px] text-dim">{bot.sourceName || "Discord source"} · v{bot.version}</p></div><StatusPill status={bot.status} /></div>)}</div>}
    </section>
  );
}

function CreatorStep({ number, title, detail, done, action }: { number: string; title: string; detail: string; done: boolean; action: React.ReactNode }) {
  return (
    <div className="min-h-44 bg-panel p-5">
      <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-toxic">{number}</span><span className={`grid h-6 w-6 place-items-center rounded-full ${done ? "bg-up/10 text-up" : "bg-edge text-dim"}`}>{done ? <Check size={13} /> : number}</span></div>
      <h3 className="mt-5 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-2 min-h-12 text-[11px] leading-5 text-dim">{detail}</p>
      <div className="mt-3">{action}</div>
    </div>
  );
}

function KolAffiliate({ bots, summary }: { bots: ProductBot[]; summary: AffiliateSummary }) {
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
        <div><h2 className="text-sm font-semibold text-ink">KOL creator strategies</h2><p className="mt-1 text-[11px] text-dim">Published, paused, and draft strategies count toward quota according to lifecycle state.</p></div>
        <div className="font-mono text-xs text-ink">{bots.filter((bot) => bot.visibility === "public" && bot.status !== "archived").length} / 3 published</div>
      </header>
      {bots.length === 0 ? (
        <div className="p-8 text-center"><Bot className="mx-auto text-toxic" size={22} /><p className="mt-3 text-sm font-semibold text-ink">No KOL strategies yet</p><Link href="/bots/kol/new" className="mt-3 inline-flex text-xs font-semibold text-toxic">Create a strategy</Link></div>
      ) : (
        <div className="divide-y divide-edge">
          {bots.map((bot) => (
            <div key={bot.id} className="grid items-center gap-4 px-5 py-4 md:grid-cols-[1fr_auto_auto_auto]">
              <div className="min-w-0"><p className="truncate text-xs font-semibold text-ink">{bot.name}</p><p className="mt-1 truncate font-mono text-[9px] text-dim">{bot.strategySlug || "Private draft"} · v{bot.version}</p></div>
              <span className="font-mono text-[10px] text-dim">{bot.followers || 0} followers</span>
              <span className="font-mono text-[10px] text-ink">{formatSol(bot.volumeLamports)}</span>
              <StatusPill status={bot.moderationStatus || bot.status} />
            </div>
          ))}
        </div>
      )}
      <div className="border-t border-edge px-5 py-4 text-[11px] text-dim">Accrued KOL commission: <span className="font-mono text-ink">{formatSol(summary.lifetimeLamports)}</span> at a default 0.20% rate.</div>
    </section>
  );
}

function RecentEvents({ events }: { events: any[] }) {
  return (
    <section className="mt-5 overflow-hidden rounded-md border border-edge bg-panel">
      <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Recent earning events</h2></header>
      {events.length === 0 ? <p className="px-5 py-8 text-center text-xs text-dim">No creator commission events yet.</p> : (
        <div className="divide-y divide-edge">
          {events.slice(0, 12).map((event) => <div key={event.id} className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto]"><div><p className="text-xs font-semibold text-ink">{event.sourceType} commission</p><p className="mt-1 font-mono text-[9px] text-dim">{event.sourceId || "platform"} · {event.rateBps ? `${event.rateBps / 100}%` : "adjustment"}</p></div><span className={`font-mono text-xs ${Number(event.amountLamports) >= 0 ? "text-up" : "text-down"}`}>{formatSol(event.amountLamports)}</span><span className="font-mono text-[9px] text-dim">{formatWhen(event.created_at)}</span></div>)}
        </div>
      )}
    </section>
  );
}

function PayoutHistory({ summary, onRequest }: { summary: AffiliateSummary; onRequest: () => void }) {
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-md border border-edge bg-panel">
        <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Payout history</h2><p className="mt-1 text-[11px] text-dim">A payout is not shown as paid until its on-chain transaction is confirmed.</p></header>
        {summary.payouts.length === 0 ? <p className="px-5 py-12 text-center text-xs text-dim">No payout requests yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-4 py-3">Requested</th><th className="px-4 py-3">Gross</th><th className="px-4 py-3">Fee</th><th className="px-4 py-3">Net</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody>{summary.payouts.map((payout) => <tr key={payout.id} className="border-t border-edge text-xs"><td className="px-4 py-4 font-mono text-dim">{formatWhen(payout.requested_at)}</td><td className="px-4 py-4 font-mono text-ink">{formatSol(payout.grossLamports)}</td><td className="px-4 py-4 font-mono text-dim">{formatSol(payout.processingFeeLamports)}</td><td className="px-4 py-4 font-mono text-ink">{formatSol(payout.netLamports)}</td><td className="px-4 py-4 font-mono text-[9px] text-dim">{payout.destinationWallet.slice(0, 6)}...{payout.destinationWallet.slice(-5)}</td><td className="px-4 py-4"><StatusPill status={payout.status} /></td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="h-fit rounded-md border border-edge bg-panel p-5">
        <p className="field-label">Available balance</p><p className="mt-2 font-mono text-2xl text-ink">{formatSol(summary.availableLamports)}</p>
        <dl className="mt-5 divide-y divide-edge border-y border-edge"><div className="flex justify-between py-3 text-xs text-dim"><dt>Minimum request</dt><dd className="font-mono text-ink">{formatSol(summary.minimumPayoutLamports)}</dd></div><div className="flex justify-between py-3 text-xs text-dim"><dt>Processing fee</dt><dd className="font-mono text-ink">{formatSol(summary.processingFeeLamports)}</dd></div></dl>
        <button type="button" onClick={onRequest} disabled={Number(summary.availableLamports) < Number(summary.minimumPayoutLamports)} className="mt-5 min-h-11 w-full rounded-md bg-toxic text-sm font-semibold text-[#17110c] disabled:opacity-40">Request payout</button>
      </aside>
    </div>
  );
}

function PayoutModal({
  summary,
  defaultWallet,
  getAccessToken,
  identityToken,
  onClose,
  onSuccess
}: {
  summary: AffiliateSummary;
  defaultWallet: string;
  getAccessToken: () => Promise<string | null>;
  identityToken: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState(Math.max(0.1, Math.min(lamportsToSol(summary.availableLamports), 1)));
  const [wallet, setWallet] = useState(defaultWallet);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const fee = lamportsToSol(summary.processingFeeLamports);
  const net = Math.max(0, amount - fee);
  const invalid = amount < 0.1 || amount > lamportsToSol(summary.availableLamports) || net <= 0 || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);

  async function submit() {
    if (invalid || !confirmed) return;
    setBusy(true);
    try {
      await productFetch("/api/product/payouts", { getAccessToken, identityToken }, {
        method: "POST",
        body: JSON.stringify({ destinationWallet: wallet, grossLamports: solToLamports(amount), confirmed: true })
      });
      toast("Payout request submitted for review");
      onSuccess();
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not request payout", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="payout-title" className="w-full max-w-lg rounded-md border border-edge bg-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-edge p-5"><div><p className="font-mono text-[9px] uppercase text-toxic">Commission payout</p><h2 id="payout-title" className="mt-2 text-lg font-semibold text-ink">Request withdrawal</h2></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim" aria-label="Close payout"><X size={15} /></button></header>
        <div className="space-y-4 p-5">
          <label className="block"><span className="field-label">Gross requested amount</span><span className="field-control mt-1.5 flex items-center px-3"><input type="number" value={amount} min={0.1} step={0.01} onChange={(event) => setAmount(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none" /><span className="font-mono text-[10px] text-dim">SOL</span></span></label>
          <label className="block"><span className="field-label">Destination Solana wallet</span><input value={wallet} onChange={(event) => setWallet(event.target.value.trim())} className="field-control mt-1.5 px-3 font-mono text-xs" /></label>
          <div className="divide-y divide-edge rounded-md border border-edge bg-void px-3">
            <div className="flex justify-between py-3 text-xs text-dim"><span>Gross request</span><span className="font-mono text-ink">{amount.toFixed(3)} SOL</span></div>
            <div className="flex justify-between py-3 text-xs text-dim"><span>Processing/admin fee</span><span className="font-mono text-ink">-{fee.toFixed(3)} SOL</span></div>
            <div className="flex justify-between py-3 text-xs font-semibold text-ink"><span>Net wallet payout</span><span className="font-mono">{net.toFixed(3)} SOL</span></div>
          </div>
          <label className="flex items-start gap-2 text-[11px] leading-5 text-dim"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#b98b5d]" />I confirm the destination, gross amount, fixed 0.043 SOL fee, and net payout. I understand this request is pending until reviewed and reconciled.</label>
        </div>
        <footer className="flex justify-end gap-2 border-t border-edge p-5"><button type="button" onClick={onClose} className="min-h-11 rounded-md border border-edge px-5 text-sm font-semibold text-ink">Cancel</button><button type="button" onClick={submit} disabled={invalid || !confirmed || busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-toxic px-5 text-sm font-semibold text-[#17110c] disabled:opacity-40">{busy && <Loader2 size={14} className="animate-spin" />}Submit request</button></footer>
      </div>
    </div>
  );
}
