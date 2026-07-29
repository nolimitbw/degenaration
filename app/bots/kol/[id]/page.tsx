"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import {
  ArrowLeft,
  Bot,
  Check,
  Pause,
  Play,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { EmptyState, Metric, PageHeader, ProductTabs, Segmented, StatusPill } from "@/components/product/Primitives";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";
import { formatPercentBps, formatSol, formatWhen, productFetch, solToLamports, type KolStrategy } from "@/lib/product-api";
import { AUTOMATED_MAINNET_RELEASE } from "@/lib/trading-release";

const TABS = [
  { href: "/bots", label: "Overview" },
  { href: "/bots/discord", label: "Discord Bot" },
  { href: "/bots/kol", label: "KOL Bot" },
  { href: "/bots/manage", label: "My Bots" }
];

type Period = "1d" | "7d" | "30d" | "3m";

export default function KolStrategyDetailsPage() {
  const params = useParams<{ id: string }>();
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const toast = useToast();
  const walletAddress = getSolanaAddress(user) || "";
  const walletId = getSolanaWalletId(user) || "";
  const delegated = hasDelegatedSolanaWallet(user);
  const [period, setPeriod] = useState<Period>("30d");
  const [strategy, setStrategy] = useState<KolStrategy | null | undefined>(undefined);
  const [subscription, setSubscription] = useState<any | null>(null);
  const [buyAmount, setBuyAmount] = useState(0.5);
  const [maximumCapital, setMaximumCapital] = useState(3);
  const [dailyLoss, setDailyLoss] = useState(1);
  const [maxOpenTrades, setMaxOpenTrades] = useState(3);
  const [slippage, setSlippage] = useState(3);
  const [priorityFee, setPriorityFee] = useState(500000);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStrategy(undefined);
    productFetch<{ strategies: KolStrategy[] }>(`/api/product/marketplace/kol?period=${period}`)
      .then((data) => setStrategy((data.strategies || []).find((item) => item.id === params.id) || null))
      .catch(() => setStrategy(null));
  }, [params.id, period]);

  useEffect(() => {
    if (!authenticated) {
      setSubscription(null);
      return;
    }
    productFetch<{ subscriptions: any[] }>("/api/product/kol-subscriptions", { getAccessToken })
      .then((data) => {
        const current = (data.subscriptions || []).find((item) => item.strategyId === params.id) || null;
        setSubscription(current);
        if (current?.config) {
          const config = current.config;
          setBuyAmount(Number(config.buyAmountLamports || 0) / 1e9 || 0.5);
          setMaximumCapital(Number(config.maximumCapitalLamports || 0) / 1e9 || 3);
          setDailyLoss(Number(config.dailyLossLimitLamports || 0) / 1e9 || 1);
          setMaxOpenTrades(Number(config.maxOpenTrades || 3));
          setSlippage(Number(config.slippageBps || 300) / 100);
          setPriorityFee(Number(config.priorityFeeMaxLamports || 500000));
        }
      })
      .catch(() => setSubscription(null));
  }, [authenticated, getAccessToken, params.id]);

  const invalid = useMemo(() => {
    if (buyAmount <= 0 || buyAmount > 100) return "Buy amount must be between 0 and 100 SOL.";
    if (maximumCapital < buyAmount) return "Maximum capital must cover at least one entry.";
    if (dailyLoss <= 0 || dailyLoss > maximumCapital) return "Daily loss limit must fit inside maximum capital.";
    if (maxOpenTrades < 1 || maxOpenTrades > 100) return "Maximum open trades must be 1 to 100.";
    if (slippage <= 0 || slippage > 20) return "Slippage must be 0.01% to 20%.";
    return null;
  }, [buyAmount, dailyLoss, maxOpenTrades, maximumCapital, slippage]);

  async function save(status: "active" | "paused") {
    if (!authenticated) {
      login();
      return;
    }
    if (!strategy) return;
    if (status === "active" && !AUTOMATED_MAINNET_RELEASE.enabled) {
      toast(AUTOMATED_MAINNET_RELEASE.reason, "err");
      return;
    }
    if (status === "active" && invalid) {
      toast(invalid, "err");
      return;
    }
    if (status === "active" && !confirmed) {
      toast("Confirm the copy settings and fee before activation.", "err");
      return;
    }
    if (!walletAddress || !walletId || !delegated) {
      toast("Connect a delegated Solana execution wallet first.", "err");
      return;
    }
    setSaving(true);
    try {
      const data = await productFetch<{ subscription: any }>("/api/product/kol-subscriptions", { getAccessToken, identityToken }, {
        method: "POST",
        body: JSON.stringify({
          strategyId: strategy.id,
          walletAddress,
          walletId,
          status,
          confirmed: status === "active",
          buyAmountLamports: solToLamports(buyAmount),
          maximumCapitalLamports: solToLamports(maximumCapital),
          dailyLossLimitLamports: solToLamports(dailyLoss),
          maxOpenTrades,
          slippageBps: Math.round(slippage * 100),
          priorityFeeMaxLamports: Math.round(priorityFee),
          riskOverrides: { mode: "stricter-only" }
        })
      });
      setSubscription(data.subscription);
      toast(status === "active" ? "KOL copy activated on Solana Mainnet" : "KOL copy paused");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not save KOL copy", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Bots / KOL / Strategy"
        title={strategy?.name || "KOL strategy"}
        description="Review net-of-fee history and configure your own bounded capital controls before copying."
        actions={<Link href="/bots/kol" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink"><ArrowLeft size={15} /> Marketplace</Link>}
      />
      <ProductTabs items={TABS} active="/bots/kol" />

      {strategy === undefined && <div className="mt-6 h-96 animate-pulse rounded-md border border-edge bg-panel" />}
      {strategy === null && <div className="mt-6"><EmptyState icon={Bot} title="Strategy unavailable" description="It may be private, awaiting review, suspended, archived, or temporarily unavailable." /></div>}
      {strategy && (
        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            <section className="overflow-hidden rounded-md border border-edge bg-panel">
              <header className="flex flex-wrap items-start gap-4 border-b border-edge p-5">
                <span className="grid h-14 w-14 place-items-center rounded-md border border-toxic/30 bg-toxic/10 font-mono text-base font-semibold text-toxic">{strategy.name.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-ink">{strategy.name}</h2><StatusPill status={strategy.insufficientHistory ? "insufficient history" : "reviewed"} /></div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-dim">{strategy.description || "No public strategy description was provided."}</p>
                  <p className="mt-2 font-mono text-[9px] uppercase text-dim">
                    {strategy.creatorName || "Verified creator"} · Strategy version {strategy.version || 1}
                  </p>
                </div>
                <span className="rounded-sm border border-edge bg-void px-2 py-1 font-mono text-[9px] uppercase text-dim">{strategy.riskTier} risk</span>
              </header>
              <div className="flex justify-end border-b border-edge p-3"><Segmented value={period} onChange={setPeriod} label="Strategy performance period" options={[{ value: "1d", label: "1D" }, { value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "3m", label: "3M" }]} /></div>
              <div className="grid grid-cols-2 divide-x divide-y divide-edge py-4 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
                <Metric label="Net PnL" value={strategy.insufficientHistory ? "--" : formatSol(strategy.netPnlLamports)} tone={Number(strategy.netPnlLamports || 0) >= 0 ? "positive" : "negative"} />
                <Metric label="Realized PnL" value={strategy.insufficientHistory ? "--" : formatSol(strategy.realizedPnlLamports)} />
                <Metric label="Win rate" value={strategy.insufficientHistory ? "--" : formatPercentBps(strategy.winRateBps)} />
                <Metric label="Max drawdown" value={strategy.insufficientHistory ? "--" : formatPercentBps(strategy.maxDrawdownBps)} />
                <Metric label="Followers" value={strategy.followers} />
                <Metric label="Creator fee" value={formatPercentBps(strategy.creatorFeeBps)} />
              </div>
            </section>

            <section className="rounded-md border border-edge bg-panel">
              <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Ledger statistics</h2><p className="mt-1 text-[11px] text-dim">Calculated from immutable execution records, not creator-submitted percentages.</p></header>
              <div className="grid grid-cols-2 gap-px bg-edge md:grid-cols-4">
                <div className="bg-void p-5"><p className="field-label">Completed sample</p><p className="mt-2 font-mono text-xl text-ink">{strategy.sampleSize}</p></div>
                <div className="bg-void p-5"><p className="field-label">Traded volume</p><p className="mt-2 font-mono text-xl text-ink">{formatSol(strategy.volumeLamports)}</p></div>
                <div className="bg-void p-5"><p className="field-label">Network fees</p><p className="mt-2 font-mono text-xl text-ink">{formatSol(strategy.networkFeesLamports)}</p></div>
                <div className="bg-void p-5"><p className="field-label">Open trades</p><p className="mt-2 font-mono text-xl text-ink">{strategy.openTrades}</p></div>
              </div>
              <div className="flex flex-wrap justify-between gap-3 border-t border-edge px-5 py-4 font-mono text-[9px] text-dim"><span>Active since {formatWhen(strategy.activeSince)}</span><span>Updated {formatWhen(strategy.updatedAt)}</span></div>
            </section>

            <StrategyConfiguration strategy={strategy} />

            <section className="rounded-md border border-edge bg-panel">
              <header className="border-b border-edge px-5 py-4"><h2 className="text-sm font-semibold text-ink">Copying policy</h2></header>
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                {[
                  ["Immutable strategy version", "Your copy snapshots the current reviewed version. Future creator edits do not silently rewrite open positions."],
                  ["Stricter overrides only", "Subscriber capital, slippage, and loss controls can reduce risk without weakening creator requirements."],
                  ["No self-copy commission", "Linked creator accounts are blocked from earning commission on their own strategy."],
                  ["Confirmed trades only", "The 0.2% creator commission accrues only after an eligible copied trade is confirmed and reconciled."]
                ].map(([title, copy]) => <div key={title} className="flex gap-3"><Check size={16} className="mt-0.5 shrink-0 text-up" /><div><p className="text-xs font-semibold text-ink">{title}</p><p className="mt-1 text-[11px] leading-5 text-dim">{copy}</p></div></div>)}
              </div>
            </section>
          </div>

          <aside className="h-fit overflow-hidden rounded-md border border-edge bg-panel xl:sticky xl:top-24">
            <header className="border-b border-edge p-5">
              <div className="flex items-center justify-between gap-3"><div><p className="font-mono text-[9px] uppercase text-toxic">Subscriber setup</p><h2 className="mt-2 text-base font-semibold text-ink">Your copy controls</h2></div>{subscription && <StatusPill status={subscription.status} />}</div>
            </header>
            <div className="space-y-4 p-5">
              <div className="rounded-md border border-edge bg-void p-3">
                <p className="field-label">Execution wallet</p>
                <div className="mt-2 flex items-center gap-2"><WalletCards size={15} className={walletAddress ? "text-toxic" : "text-dim"} /><span className="truncate font-mono text-xs text-ink">{walletAddress ? `${walletAddress.slice(0, 7)}...${walletAddress.slice(-6)}` : "Not connected"}</span></div>
                <p className={`mt-1 text-[10px] ${delegated ? "text-up" : "text-toxic"}`}>{delegated ? "Delegated execution enabled" : "Delegation required"}</p>
              </div>
              <CopyField label="Buy amount" value={buyAmount} onChange={setBuyAmount} suffix="SOL" step={0.1} />
              <CopyField label="Maximum capital" value={maximumCapital} onChange={setMaximumCapital} suffix="SOL" step={0.5} />
              <CopyField label="Daily loss limit" value={dailyLoss} onChange={setDailyLoss} suffix="SOL" step={0.1} />
              <CopyField label="Maximum open positions" value={maxOpenTrades} onChange={(value) => setMaxOpenTrades(Math.round(value))} suffix="trades" step={1} />
              <CopyField label="Slippage maximum" value={slippage} onChange={setSlippage} suffix="%" step={0.25} />
              <CopyField label="Priority fee maximum" value={priorityFee} onChange={(value) => setPriorityFee(Math.round(value))} suffix="lamports" step={100000} />
              <div className="rounded-md border border-edge bg-void p-3 text-xs">
                <div className="flex justify-between gap-3 text-dim"><span>Creator fee</span><span className="font-mono text-ink">{formatPercentBps(strategy.creatorFeeBps)}</span></div>
                <div className="mt-2 flex justify-between gap-3 text-dim"><span>Network</span><span className="font-mono text-ink">{AUTOMATED_MAINNET_RELEASE.label}</span></div>
              </div>
              {invalid && <p className="rounded-md border border-down/35 bg-down/5 px-3 py-2 text-[11px] text-down">{invalid}</p>}
              <label className="flex items-start gap-2 text-[11px] leading-5 text-dim"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#b98b5d]" />I reviewed this strategy, its fee, and my worst-case capital limit.</label>
              <button
                type="button"
                disabled
                title={AUTOMATED_MAINNET_RELEASE.reason}
                className="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-edge bg-void px-4 text-sm font-semibold text-dim opacity-70"
              >
                <Play size={15} />
                Automated trading not yet available
              </button>
              {subscription?.status === "active" && <button type="button" onClick={() => save("paused")} disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-edge px-4 text-sm font-semibold text-ink"><Pause size={15} /> Pause entries</button>}
              {!authenticated && <button type="button" onClick={login} className="min-h-11 w-full rounded-md border border-edge text-sm font-semibold text-ink">Connect account</button>}
              <p className="flex gap-2 text-[10px] leading-4 text-dim"><ShieldCheck size={14} className="shrink-0 text-up" />{AUTOMATED_MAINNET_RELEASE.reason}</p>
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function StrategyConfiguration({ strategy }: { strategy: KolStrategy }) {
  const config = strategy.config || {};
  const trigger = config.trigger || {};
  const dca = config.dca || {};
  const takeProfit = config.takeProfit || {};
  const stopLoss = config.stopLoss || {};
  const filters = config.safetyFilters || {};
  const enabledRanges = Object.values(filters.ranges || {}).filter((item: any) => item?.enabled).length;
  const enabledFlags = Object.values(filters.flags || {}).filter(Boolean).length;
  const takeProfitText = Array.isArray(takeProfit.levels) && takeProfit.levels.length
    ? takeProfit.levels.map((level: any) => `+${Number(level.targetBps || 0) / 100}% / sell ${Number(level.sellBps || 0) / 100}%`).join(" · ")
    : "No public take-profit levels";
  const dcaText = dca.enabled
    ? `${Array.isArray(dca.levels) ? dca.levels.length : 0} levels · ${Number(dca.expirationMinutes || 0)} minute expiry`
    : "Disabled";

  return (
    <section className="rounded-md border border-edge bg-panel">
      <header className="border-b border-edge px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">Reviewed strategy configuration</h2>
        <p className="mt-1 text-[11px] text-dim">Wallet identifiers are removed. Your copy snapshots this exact public version.</p>
      </header>
      <div className="grid gap-px bg-edge sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Trigger", `${Number(trigger.priceDropBps || 0) / 100}% drop`],
          ["Reference", String(trigger.referenceMode || "recent-ath").replace("-", " ")],
          ["Lookback", `${Number(trigger.lookbackMinutes || 0)} minutes`],
          ["Entry", formatSol(config.buyAmountLamports)],
          ["Capital ceiling", formatSol(config.maximumCapitalLamports)],
          ["Maximum positions", String(config.maxOpenTrades || "--")],
          ["DCA", dcaText],
          ["Risk checks", `${enabledRanges + enabledFlags} enabled · fail closed`]
        ].map(([label, value]) => (
          <div key={label} className="bg-void p-4">
            <p className="field-label">{label}</p>
            <p className="mt-2 text-xs leading-5 text-ink">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-px border-t border-edge bg-edge lg:grid-cols-[1.4fr_.6fr]">
        <div className="bg-panel p-4">
          <p className="field-label">Take-profit schedule</p>
          <p className="mt-2 text-xs leading-5 text-ink">{takeProfitText}</p>
        </div>
        <div className="bg-panel p-4">
          <p className="field-label">Stop loss</p>
          <p className="mt-2 text-xs leading-5 text-ink">
            -{Number(stopLoss.stopBps || 0) / 100}%{stopLoss.trailing ? " · trailing" : ""}{stopLoss.dynamic ? " · dynamic" : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

function CopyField({ label, value, onChange, suffix, step }: { label: string; value: number; onChange: (value: number) => void; suffix: string; step: number }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <span className="field-control mt-1.5 flex items-center px-3">
        <input type="number" value={value} step={step} min={0} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none" />
        <span className="font-mono text-[9px] text-dim">{suffix}</span>
      </span>
    </label>
  );
}
