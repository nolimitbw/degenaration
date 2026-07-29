"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  CircleHelp,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { getSolanaAddress, getSolanaWalletId, hasDelegatedSolanaWallet } from "@/lib/solanaWallet";
import {
  formatPercentBps,
  formatSol,
  productFetch,
  solToLamports,
  type BotKind,
  type DiscordSource,
  type ProductBot
} from "@/lib/product-api";
import { AUTOMATED_MAINNET_RELEASE } from "@/lib/trading-release";

type TpLevel = { targetBps: number; sellBps: number; trailingBps: number };
type DcaLevel = { dropBps: number; buyAmountSol: number };
type FilterValue = { enabled: boolean; min: number; max: number };

type FilterDefinition = {
  key: string;
  label: string;
  source: string;
  unit: string;
  min: number;
  max: number;
  step?: number;
};

const FILTERS: FilterDefinition[] = [
  { key: "tokenAgeMinutes", label: "Token age", source: "Scanner / chain", unit: "min", min: 5, max: 10080 },
  { key: "marketCapUsd", label: "Market cap", source: "DexScreener", unit: "USD", min: 25000, max: 25000000 },
  { key: "liquidityUsd", label: "Liquidity", source: "Route + pool", unit: "USD", min: 15000, max: 10000000 },
  { key: "volumeUsd", label: "Volume (24H)", source: "DexScreener", unit: "USD", min: 10000, max: 100000000 },
  { key: "volatilityBps", label: "Volatility index", source: "Market snapshots", unit: "bps", min: 100, max: 10000 },
  { key: "smartBuyVolumeSol", label: "Smart-buy volume", source: "Wallet classifier", unit: "SOL", min: 0, max: 100000 },
  { key: "smartBuyWallets", label: "Smart-buy wallets", source: "Wallet classifier", unit: "wallets", min: 0, max: 10000 },
  { key: "smartSellVolumeSol", label: "Smart-sell volume", source: "Wallet classifier", unit: "SOL", min: 0, max: 100000 },
  { key: "smartSellWallets", label: "Smart-sell wallets", source: "Wallet classifier", unit: "wallets", min: 0, max: 10000 },
  { key: "smartMoneyInflowSol", label: "Smart-money inflow", source: "Wallet classifier", unit: "SOL", min: 0, max: 100000 },
  { key: "priceChangeBps", label: "Price change", source: "Market snapshots", unit: "bps", min: -10000, max: 100000 },
  { key: "riskyWalletBps", label: "Risky-wallet share", source: "RugCheck", unit: "bps", min: 0, max: 1500 },
  { key: "freshWalletBps", label: "Fresh-wallet share", source: "RugCheck", unit: "bps", min: 0, max: 2500 },
  { key: "holderCount", label: "Total holders", source: "RugCheck / RPC", unit: "holders", min: 100, max: 10000000 },
  { key: "top10HolderBps", label: "Top-10 concentration", source: "RugCheck", unit: "bps", min: 0, max: 3500 },
  { key: "phishingHolderBps", label: "Phishing holders", source: "Risk provider", unit: "bps", min: 0, max: 100 },
  { key: "bundlerHolderBps", label: "Bundler holders", source: "Risk provider", unit: "bps", min: 0, max: 1000 },
  { key: "sniperHolderBps", label: "Sniper holders", source: "Risk provider", unit: "bps", min: 0, max: 1200 },
  { key: "botHolderBps", label: "Bot holders", source: "Risk provider", unit: "bps", min: 0, max: 1500 },
  { key: "kolHolderBps", label: "KOL holders", source: "Wallet classifier", unit: "bps", min: 0, max: 3500 },
  { key: "smartMoneyHolderBps", label: "Smart-money holders", source: "Wallet classifier", unit: "bps", min: 0, max: 5000 },
  { key: "developerHolderBps", label: "Developer holdings", source: "Risk provider", unit: "bps", min: 0, max: 500 },
  { key: "degenBotHolderBps", label: "Degen-bot holdings", source: "Wallet classifier", unit: "bps", min: 0, max: 1500 },
  { key: "minimumRouteLiquidityUsd", label: "Executable route liquidity", source: "Jupiter route", unit: "USD", min: 15000, max: 10000000 },
  { key: "maximumPriceImpactBps", label: "Maximum price impact", source: "Jupiter quote", unit: "bps", min: 0, max: 500 }
];

const FLAG_FILTERS = [
  ["latinNameSymbol", "Latin name and symbol", "Token metadata"],
  ["verifiedLiquidity", "Verified DEX liquidity", "Pool adapter"],
  ["mintAuthorityRevoked", "Mint authority revoked", "Solana RPC"],
  ["freezeAuthorityRevoked", "Freeze authority revoked", "Solana RPC"],
  ["immutableMetadata", "Immutable metadata", "Token metadata"],
  ["lpLockedOrBurned", "LP locked or burned", "Risk provider"],
  ["token2022ExtensionsAllowed", "Supported Token-2022 extensions only", "Solana RPC"],
  ["sellRouteRequired", "Executable sell route", "Jupiter simulation"],
  ["buySimulationRequired", "Successful buy simulation", "Transaction simulator"],
  ["sellSimulationRequired", "Successful sell simulation", "Transaction simulator"]
] as const;

const PRESETS = {
  "Smart Money": { priceDropBps: 1200, lookbackMinutes: 60, riskTier: "high" },
  "High Volume": { priceDropBps: 1800, lookbackMinutes: 30, riskTier: "very-high" },
  "Top-10 Alpha": { priceDropBps: 1000, lookbackMinutes: 240, riskTier: "high" },
  "Last Alpha Calls": { priceDropBps: 1500, lookbackMinutes: 1440, riskTier: "high" }
} as const;

function defaultFilters() {
  return Object.fromEntries(FILTERS.map((filter) => [filter.key, { enabled: ["liquidityUsd", "marketCapUsd", "top10HolderBps", "minimumRouteLiquidityUsd", "maximumPriceImpactBps"].includes(filter.key), min: filter.min, max: filter.max }])) as Record<string, FilterValue>;
}

function defaultFlags() {
  return Object.fromEntries(FLAG_FILTERS.map(([key]) => [key, true])) as Record<string, boolean>;
}

export default function BotBuilder({ kind, botId }: { kind: BotKind; botId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authenticated, user, login, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { createWallet } = useCreateWallet();
  const toast = useToast();
  const walletAddress = getSolanaAddress(user) || "";
  const walletId = getSolanaWalletId(user) || "";
  const delegated = hasDelegatedSolanaWallet(user);

  const [name, setName] = useState(kind === "discord" ? "Discord call bot" : "Volatility strategy");
  const [description, setDescription] = useState("");
  const [sourceId, setSourceId] = useState(searchParams.get("source") || "");
  const [channelId, setChannelId] = useState("");
  const [sources, setSources] = useState<DiscordSource[]>([]);
  const [buyAmountSol, setBuyAmountSol] = useState(0.5);
  const [maximumCapitalSol, setMaximumCapitalSol] = useState(3);
  const [dailyLossSol, setDailyLossSol] = useState(1);
  const [perTokenSol, setPerTokenSol] = useState(1);
  const [maxOpenTrades, setMaxOpenTrades] = useState(3);
  const [entryMode, setEntryMode] = useState<"market" | "limit">("market");
  const [slippageBps, setSlippageBps] = useState(300);
  const [priorityStrategy, setPriorityStrategy] = useState<"auto" | "economy" | "fast">("auto");
  const [priorityFeeMax, setPriorityFeeMax] = useState(500_000);
  const [autoRetryCount, setAutoRetryCount] = useState(2);
  const [limitRetryCount, setLimitRetryCount] = useState(2);
  const [quoteExpirationSeconds, setQuoteExpirationSeconds] = useState(30);
  const [cooldownSeconds, setCooldownSeconds] = useState(900);
  const [simulationRequired, setSimulationRequired] = useState(true);
  const [firstCallOnly, setFirstCallOnly] = useState(false);
  const [tpLevels, setTpLevels] = useState<TpLevel[]>([
    { targetBps: 10000, sellBps: 5000, trailingBps: 0 },
    { targetBps: 40000, sellBps: 2500, trailingBps: 0 }
  ]);
  const [trailingTakeProfit, setTrailingTakeProfit] = useState(false);
  const [stopBps, setStopBps] = useState(4000);
  const [trailingStop, setTrailingStop] = useState(false);
  const [dynamicStop, setDynamicStop] = useState(false);
  const [stopDelaySeconds, setStopDelaySeconds] = useState(5);
  const [freezeAfterStop, setFreezeAfterStop] = useState(true);
  const [emergencyExit, setEmergencyExit] = useState(true);
  const [visibility, setVisibility] = useState<"private" | "public">(kind === "kol" ? "public" : "private");
  const [manualMints, setManualMints] = useState("");
  const [preset, setPreset] = useState<keyof typeof PRESETS>("Smart Money");
  const [priceDropBps, setPriceDropBps] = useState(1200);
  const [referenceMode, setReferenceMode] = useState<"recent-ath" | "moving-average">("recent-ath");
  const [lookbackMinutes, setLookbackMinutes] = useState(60);
  const [dcaEnabled, setDcaEnabled] = useState(true);
  const [dcaLevels, setDcaLevels] = useState<DcaLevel[]>([
    { dropBps: 1000, buyAmountSol: 0.25 },
    { dropBps: 2000, buyAmountSol: 0.25 }
  ]);
  const [dcaExpirationMinutes, setDcaExpirationMinutes] = useState(240);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(15);
  const [previewCount, setPreviewCount] = useState(10);
  const [degenMode, setDegenMode] = useState(false);
  const [riskTier, setRiskTier] = useState<"moderate" | "high" | "very-high">("high");
  const [filters, setFilters] = useState(defaultFilters);
  const [flags, setFlags] = useState(defaultFlags);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [walletCreating, setWalletCreating] = useState(false);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(botId));
  const [confirmStatus, setConfirmStatus] = useState<"draft" | "active" | null>(null);
  const [confirmReviewed, setConfirmReviewed] = useState(false);

  useEffect(() => {
    if (!securityOpen && !confirmStatus) return;

    const previousOverflow = document.body.style.overflow;
    const closeDialog = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSecurityOpen(false);
      setConfirmStatus(null);
      setConfirmReviewed(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeDialog);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeDialog);
    };
  }, [confirmStatus, securityOpen]);

  useEffect(() => {
    if (kind !== "discord") return;
    productFetch<{ sources: DiscordSource[] }>("/api/product/marketplace/discord?period=7d&sort=performance")
      .then((data) => {
        setSources(data.sources || []);
        setSourceId((current) => current || data.sources?.[0]?.id || "");
      })
      .catch(() => setSources([]));
  }, [kind]);

  useEffect(() => {
    if (!botId || !authenticated) return;
    setLoading(true);
    productFetch<{ bot: ProductBot }>(`/api/product/bots?id=${encodeURIComponent(botId)}`, { getAccessToken })
      .then(({ bot }) => {
        const config = bot.config || {};
        setName(bot.name);
        setDescription(bot.description || "");
        setSourceId(bot.sourceGroupId || "");
        setChannelId(config.channelId || "");
        setBuyAmountSol(Number(config.buyAmountLamports || 0) / 1e9 || 0.5);
        setMaximumCapitalSol(Number(config.maximumCapitalLamports || 0) / 1e9 || 3);
        setDailyLossSol(Number(config.dailyLossLimitLamports || 0) / 1e9 || 1);
        setPerTokenSol(Number(config.perTokenExposureLamports || 0) / 1e9 || 1);
        setMaxOpenTrades(Number(config.maxOpenTrades || 3));
        setEntryMode(config.entryMode === "limit" ? "limit" : "market");
        setSlippageBps(Number(config.slippageBps || 300));
        setPriorityStrategy(config.priorityFeeStrategy || "auto");
        setPriorityFeeMax(Number(config.priorityFeeMaxLamports || 500000));
        setAutoRetryCount(Number(config.autoRetryCount || 0));
        setLimitRetryCount(Number(config.limitRetryCount || 0));
        setQuoteExpirationSeconds(Number(config.quoteExpirationSeconds || 30));
        setCooldownSeconds(Number(config.cooldownSeconds || 900));
        setSimulationRequired(config.simulationRequired !== false);
        setFirstCallOnly(Boolean(config.firstCallOnly));
        if (Array.isArray(config.takeProfit?.levels)) setTpLevels(config.takeProfit.levels);
        setTrailingTakeProfit(Boolean(config.takeProfit?.trailing));
        setStopBps(Number(config.stopLoss?.stopBps || 4000));
        setTrailingStop(Boolean(config.stopLoss?.trailing));
        setDynamicStop(Boolean(config.stopLoss?.dynamic));
        setStopDelaySeconds(Number(config.stopLoss?.delaySeconds || 5));
        setFreezeAfterStop(config.stopLoss?.freezeAfterStop !== false);
        setEmergencyExit(config.stopLoss?.emergencyExit !== false);
        setVisibility(bot.visibility || "private");
        setManualMints(Array.isArray(config.manualMints) ? config.manualMints.join("\n") : "");
        setPriceDropBps(Number(config.trigger?.priceDropBps || 1200));
        setReferenceMode(config.trigger?.referenceMode === "moving-average" ? "moving-average" : "recent-ath");
        setLookbackMinutes(Number(config.trigger?.lookbackMinutes || 60));
        setDcaEnabled(Boolean(config.dca?.enabled));
        if (Array.isArray(config.dca?.levels)) setDcaLevels(config.dca.levels);
        setDcaExpirationMinutes(Number(config.dca?.expirationMinutes || 240));
        setAutoRefreshMinutes(Number(config.scanner?.autoRefreshMinutes || 15));
        setPreviewCount(Number(config.scanner?.previewCount || 10));
        setDegenMode(Boolean(config.scanner?.degenMode));
        setRiskTier(config.riskTier || "high");
        if (config.safetyFilters?.ranges) setFilters((current) => ({ ...current, ...config.safetyFilters.ranges }));
        if (config.safetyFilters?.flags) setFlags((current) => ({ ...current, ...config.safetyFilters.flags }));
      })
      .catch((reason) => toast(reason instanceof Error ? reason.message : "Could not load bot", "err"))
      .finally(() => setLoading(false));
  }, [authenticated, botId, getAccessToken, toast]);

  const source = sources.find((item) => item.id === sourceId);
  const tpAllocationBps = tpLevels.reduce((total, level) => total + level.sellBps, 0);
  const dcaCapital = dcaEnabled ? dcaLevels.reduce((total, level) => total + level.buyAmountSol, 0) : 0;
  const requiredCapital = (buyAmountSol + dcaCapital) * maxOpenTrades;
  const creatorFeeBps = kind === "discord" ? source?.creatorFeeBps ?? 70 : 20;
  const creatorFeeLamports = useMemo(() => {
    const notional = BigInt(solToLamports(buyAmountSol));
    return (notional * BigInt(creatorFeeBps)) / BigInt(10_000);
  }, [buyAmountSol, creatorFeeBps]);
  const platformFeeBps = 0;

  const validationError = useMemo(() => {
    if (!name.trim() || name.trim().length > 80) return "Bot name must be 1 to 80 characters.";
    if (kind === "discord" && !sourceId) return "Select an approved Discord source.";
    if (!(buyAmountSol > 0 && buyAmountSol <= 100)) return "Buy amount must be between 0 and 100 SOL.";
    if (maxOpenTrades < 1 || maxOpenTrades > 100) return "Maximum open trades must be 1 to 100.";
    if (maximumCapitalSol < requiredCapital) return `Maximum capital must cover at least ${requiredCapital.toFixed(3)} SOL.`;
    if (dailyLossSol <= 0 || dailyLossSol > maximumCapitalSol) return "Daily loss limit must be positive and no larger than maximum capital.";
    if (perTokenSol < buyAmountSol || perTokenSol > maximumCapitalSol) return "Per-token exposure must cover one buy and remain inside maximum capital.";
    if (tpAllocationBps > 10000) return "Take-profit sell allocations cannot exceed 100%.";
    if (tpLevels.some((level) => level.targetBps <= 0 || level.sellBps <= 0)) return "Take-profit targets and allocations must be positive.";
    if (stopBps <= 0 || stopBps > 10000) return "Stop loss must be between 0.01% and 100%.";
    if (kind === "kol" && dcaEnabled && buyAmountSol + dcaCapital > maximumCapitalSol) return "Entry plus DCA capital exceeds the maximum.";
    if (slippageBps < 1 || slippageBps > 2000) return "Slippage must be between 0.01% and 20%.";
    return null;
  }, [buyAmountSol, dailyLossSol, dcaCapital, dcaEnabled, kind, maxOpenTrades, maximumCapitalSol, name, perTokenSol, requiredCapital, slippageBps, sourceId, stopBps, tpAllocationBps, tpLevels]);

  function updateTp(index: number, patch: Partial<TpLevel>) {
    setTpLevels((current) => current.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level));
  }

  function updateDca(index: number, patch: Partial<DcaLevel>) {
    setDcaLevels((current) => current.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level));
  }

  function applyPreset(next: keyof typeof PRESETS) {
    const value = PRESETS[next];
    setPreset(next);
    setPriceDropBps(value.priceDropBps);
    setLookbackMinutes(value.lookbackMinutes);
    setRiskTier(value.riskTier);
  }

  async function setupWallet() {
    if (!authenticated) {
      login();
      return;
    }
    setWalletCreating(true);
    try {
      await createWallet();
      toast("Solana wallet created");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not create Solana wallet", "err");
    } finally {
      setWalletCreating(false);
    }
  }

  async function runPreview() {
    setPreviewing(true);
    setPreview(null);
    try {
      if (kind === "discord") {
        setPreview(source ? [{
          symbol: source.name,
          address: source.id,
          pass: source.measuredCalls >= 5,
          reason: source.measuredCalls >= 5 ? `${source.measuredCalls} measured calls available` : `Tracking — ${source.measuredCalls} of 5 calls measured`
        }] : []);
      } else {
        const data = await productFetch<{ tokens?: any[] }>("/api/tokens?mode=trending");
        const liquidityMinimum = filters.liquidityUsd?.enabled ? filters.liquidityUsd.min : 0;
        setPreview((data.tokens || []).slice(0, previewCount).map((token) => {
          const liquidity = Number(token.liquidityUsd || token.liquidity?.usd || 0);
          return {
            symbol: token.symbol || token.baseToken?.symbol || "Unknown",
            address: token.address || token.baseToken?.address || "",
            pass: liquidity >= liquidityMinimum,
            reason: liquidity >= liquidityMinimum ? "Current enabled preview filters pass" : `Liquidity below ${liquidityMinimum.toLocaleString()} USD`
          };
        }));
      }
    } catch {
      setPreview([]);
    } finally {
      setPreviewing(false);
    }
  }

  function buildConfig() {
    return {
      walletAddress,
      walletId,
      channelId: channelId || null,
      buyAmountLamports: solToLamports(buyAmountSol),
      maximumCapitalLamports: solToLamports(maximumCapitalSol),
      dailyLossLimitLamports: solToLamports(dailyLossSol),
      perTokenExposureLamports: solToLamports(perTokenSol),
      maxOpenTrades,
      entryMode,
      slippageBps: Math.round(slippageBps),
      priorityFeeStrategy: priorityStrategy,
      priorityFeeMaxLamports: Math.round(priorityFeeMax),
      autoRetryCount: Math.round(autoRetryCount),
      limitRetryCount: Math.round(limitRetryCount),
      quoteExpirationSeconds: Math.round(quoteExpirationSeconds),
      cooldownSeconds: Math.round(cooldownSeconds),
      simulationRequired,
      firstCallOnly,
      takeProfit: { levels: tpLevels, trailing: trailingTakeProfit },
      stopLoss: {
        stopBps: Math.round(stopBps),
        trailing: trailingStop,
        dynamic: dynamicStop,
        delaySeconds: Math.round(stopDelaySeconds),
        freezeAfterStop,
        emergencyExit
      },
      manualMints: manualMints.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
      trigger: kind === "kol" ? {
        priceDropBps: Math.round(priceDropBps),
        referenceMode,
        lookbackMinutes: Math.round(lookbackMinutes),
        stalePriceBehavior: "reject"
      } : null,
      dca: kind === "kol" ? {
        enabled: dcaEnabled,
        levels: dcaLevels,
        expirationMinutes: Math.round(dcaExpirationMinutes),
        maximumEntries: dcaLevels.length
      } : { enabled: false, levels: [] },
      scanner: {
        preset,
        autoRefreshMinutes: Math.round(autoRefreshMinutes),
        previewCount: Math.round(previewCount),
        degenMode
      },
      safetyFilters: {
        dexes: ["raydium", "pumpfun", "pumpswap", "meteora", "orca", "moonshot", "bonk"],
        ranges: filters,
        flags,
        unavailableDataBehavior: "fail-closed"
      },
      riskTier
    };
  }

  async function save(status: "draft" | "active") {
    if (!authenticated) {
      login();
      return;
    }
    if (validationError) {
      toast(validationError, "err");
      return;
    }
    if (status === "active" && !AUTOMATED_MAINNET_RELEASE.enabled) {
      toast(AUTOMATED_MAINNET_RELEASE.reason, "err");
      return;
    }
    if (status === "active" && (!walletAddress || !walletId)) {
      toast("Connect a verified Solana execution wallet first.", "err");
      return;
    }
    if (status === "active" && !delegated) {
      toast("Enable delegated 24/7 trading in Wallet before activation.", "err");
      return;
    }
    setSaving(true);
    try {
      await productFetch("/api/product/bots", { getAccessToken, identityToken }, {
        method: "POST",
        body: JSON.stringify({
          id: botId,
          kind,
          name: name.trim(),
          description: description.trim(),
          status,
          visibility: kind === "discord" ? "private" : visibility,
          executionMode: "solana-mainnet",
          sourceGroupId: kind === "discord" ? sourceId : null,
          confirmed: status === "active",
          changeNote: botId ? "Configuration updated from bot manager" : "Initial configuration",
          config: buildConfig()
        })
      });
      toast(status === "active" ? "Bot activated on Solana Mainnet" : "Draft saved");
      router.push("/bots/manage");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not save bot", "err");
    } finally {
      setSaving(false);
      setConfirmStatus(null);
      setConfirmReviewed(false);
    }
  }

  if (loading) {
    return <div className="grid min-h-[520px] place-items-center border border-edge bg-panel"><Loader2 className="animate-spin text-gold-400" /></div>;
  }

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-px overflow-hidden rounded-md border border-edge bg-edge">
          <FormSection
            title="Identity and source"
            description={kind === "discord" ? "Choose the approved community this bot follows." : "Name the strategy and choose its visibility."}
            summary={kind === "discord" ? source?.name || "Source required" : visibility === "public" ? "Public strategy" : "Private strategy"}
            defaultOpen
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <TextField label="Bot name" value={name} onChange={setName} maxLength={80} />
              {kind === "discord" ? (
                <SelectField label="Approved Discord source" value={sourceId} onChange={setSourceId} options={sources.map((item) => ({ value: item.id, label: item.name }))} />
              ) : (
                <SelectField label="Visibility" value={visibility} onChange={(value) => setVisibility(value as "private" | "public")} options={[{ value: "private", label: "Private draft" }, { value: "public", label: "Public after review" }]} />
              )}
            </div>
            <details className="group rounded-md border border-edge bg-void">
              <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3 text-xs font-medium text-ink">
                Optional description
                <ChevronDown aria-hidden="true" size={15} className="text-dim transition group-open:rotate-180" />
              </summary>
              <label className="block border-t border-edge p-3">
                <span className="sr-only">Description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} rows={3} className="field-control resize-y px-3 py-2.5" placeholder="Describe the signal logic and intended risk profile." />
              </label>
            </details>
            {kind === "discord" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <SelectField
                  label="Call channel"
                  value={channelId}
                  onChange={setChannelId}
                  options={[{ value: "", label: "All approved channels" }, ...(source?.channels || []).map((channel) => ({ value: channel.id, label: channel.name || channel.id }))]}
                />
                <div className="rounded-md border border-edge bg-void px-4 py-3">
                  <p className="field-label">Source performance</p>
                  <p className="mt-2 font-mono text-sm text-ink">{source?.measuredCalls || 0} measured calls · {source?.winRate == null ? "--" : `${source.winRate.toFixed(1)}%`} 2x rate</p>
                  <p className="mt-1 text-[11px] text-dim">{formatPercentBps(creatorFeeBps)} creator fee on confirmed copied notional</p>
                </div>
              </div>
            )}
          </FormSection>

          <FormSection
            title="Funding and exposure"
            description="Set the amount per entry and the total capital ceiling."
            summary={`${buyAmountSol.toFixed(2)} SOL per entry · ${maxOpenTrades} open max`}
            defaultOpen
          >
            <div className="grid gap-4 md:grid-cols-3">
              <NumberField label="Buy amount" value={buyAmountSol} onChange={setBuyAmountSol} unit="SOL" step={0.1} min={0.01} />
              <NumberField label="Maximum capital" value={maximumCapitalSol} onChange={setMaximumCapitalSol} unit="SOL" step={0.5} min={0.1} />
              <NumberField label="Maximum open trades" value={maxOpenTrades} onChange={(value) => setMaxOpenTrades(Math.round(value))} unit="trades" step={1} min={1} max={100} />
            </div>
            <div className="flex flex-wrap gap-2">
              {[0.1, 0.5, 1, 5].map((amount) => (
                <button key={amount} type="button" onClick={() => setBuyAmountSol(amount)} className={`min-h-9 rounded-md border px-3 font-mono text-xs ${buyAmountSol === amount ? "border-gold-400 bg-gold-400/10 text-gold-400" : "border-edge text-dim hover:text-ink"}`}>{amount} SOL</button>
              ))}
            </div>
            <details className="group rounded-md border border-edge bg-void">
              <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3">
                <span>
                  <span className="block text-xs font-medium text-ink">Risk limits</span>
                  <span className="mt-0.5 block font-mono text-[9px] text-dim">{dailyLossSol.toFixed(2)} SOL daily · {perTokenSol.toFixed(2)} SOL per token</span>
                </span>
                <ChevronDown aria-hidden="true" size={15} className="text-dim transition group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 border-t border-edge p-3 sm:grid-cols-2">
                <NumberField label="Daily loss limit" value={dailyLossSol} onChange={setDailyLossSol} unit="SOL" step={0.1} min={0.01} />
                <NumberField label="Per-token exposure" value={perTokenSol} onChange={setPerTokenSol} unit="SOL" step={0.1} min={0.01} />
              </div>
            </details>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-edge bg-void px-4 py-3">
                <p className="field-label">Execution wallet</p>
                <p className="mt-2 truncate font-mono text-sm text-ink">{walletAddress ? `${walletAddress.slice(0, 7)}...${walletAddress.slice(-6)}` : "Not connected"}</p>
                <p className={`mt-1 text-[11px] ${delegated ? "text-up" : "text-gold-400"}`}>{delegated ? "Delegated execution enabled" : "Delegation required to activate"}</p>
                {!walletAddress && (
                  <button
                    type="button"
                    onClick={setupWallet}
                    disabled={walletCreating}
                    className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md border border-gold-400/45 px-3 text-xs font-semibold text-gold-400 disabled:opacity-50"
                  >
                    {walletCreating ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <WalletCards aria-hidden="true" size={14} />}
                    {authenticated ? "Create Solana wallet" : "Connect account"}
                  </button>
                )}
              </div>
              <div className="rounded-md border border-edge bg-void px-4 py-3">
                <p className="field-label">Minimum planned capital</p>
                <p className="mt-2 font-mono text-sm text-ink">{requiredCapital.toFixed(3)} SOL</p>
                <p className="mt-1 text-[11px] text-dim">Entries plus configured DCA levels</p>
              </div>
            </div>
          </FormSection>

          {kind === "kol" && (
            <FormSection
              title="Entry trigger"
              description="Choose what must happen before the strategy can enter."
              summary={`-${(priceDropBps / 100).toFixed(1)}% over ${lookbackMinutes < 60 ? `${lookbackMinutes}m` : `${lookbackMinutes / 60}h`} · ${preset}`}
              defaultOpen
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="field-label">Manual Solana mints</span>
                  <textarea value={manualMints} onChange={(event) => setManualMints(event.target.value)} rows={4} className="field-control mt-1.5 resize-y px-3 py-2.5 font-mono text-xs" placeholder="One mint per line, optional when scanner discovery is enabled" />
                </label>
                <div>
                  <span className="field-label">Scanner quick set</span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((value) => (
                      <button key={value} type="button" onClick={() => applyPreset(value)} className={`min-h-11 rounded-md border px-3 text-left text-xs font-medium ${preset === value ? "border-gold-400 bg-gold-400/10 text-ink" : "border-edge bg-void text-dim hover:text-ink"}`}>{value}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <NumberField label="Price drop" value={priceDropBps / 100} onChange={(value) => setPriceDropBps(Math.round(value * 100))} unit="%" step={0.5} min={0.1} max={99} />
                <SelectField label="Reference" value={referenceMode} onChange={(value) => setReferenceMode(value as typeof referenceMode)} options={[{ value: "recent-ath", label: "Recent ATH" }, { value: "moving-average", label: "Moving average" }]} />
                <NumberField label="Lookback period" value={lookbackMinutes} onChange={(value) => setLookbackMinutes(Math.round(value))} unit="min" step={15} min={5} max={10080} />
                <SelectField label="Risk tier" value={riskTier} onChange={(value) => setRiskTier(value as typeof riskTier)} options={[{ value: "moderate", label: "Moderate" }, { value: "high", label: "High" }, { value: "very-high", label: "Very high" }]} />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <SelectField label="Auto-refresh" value={String(autoRefreshMinutes)} onChange={(value) => setAutoRefreshMinutes(Number(value))} options={[5, 15, 30, 60, 360, 1440].map((value) => ({ value: String(value), label: value < 60 ? `${value} minutes` : `${value / 60} hours` }))} />
                <NumberField label="Preview tokens" value={previewCount} onChange={(value) => setPreviewCount(Math.round(value))} unit="tokens" step={5} min={5} max={50} />
                <Toggle label="Degen Mode" detail="Loosens non-critical discovery ranges, never authority or route checks." checked={degenMode} onChange={setDegenMode} danger />
              </div>
            </FormSection>
          )}

          {kind === "kol" && (
            <FormSection
              title="Dollar-cost averaging"
              description="Optional staged entries after a deeper drop."
              summary={dcaEnabled ? `${dcaLevels.length} levels · ${dcaCapital.toFixed(2)} SOL` : "Off"}
            >
              <Toggle label="Enable DCA" detail="Add bounded buys after deeper price drops." checked={dcaEnabled} onChange={setDcaEnabled} />
              {dcaEnabled && (
                <>
                  <div className="divide-y divide-edge rounded-md border border-edge">
                    {dcaLevels.map((level, index) => (
                      <div key={index} className="grid gap-3 p-3 sm:grid-cols-[64px_repeat(2,minmax(0,1fr))_36px] sm:items-end">
                        <p className="font-mono text-xs text-dim sm:self-center">DCA {index + 1}</p>
                        <label><span className="field-label">Additional drop</span><span className="mt-1.5 block"><CompactNumber value={level.dropBps / 100} onChange={(value) => updateDca(index, { dropBps: Math.round(value * 100) })} suffix="%" /></span></label>
                        <label><span className="field-label">Buy amount</span><span className="mt-1.5 block"><CompactNumber value={level.buyAmountSol} onChange={(value) => updateDca(index, { buyAmountSol: value })} suffix="SOL" /></span></label>
                        <button type="button" onClick={() => setDcaLevels((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={dcaLevels.length === 1} className="grid h-9 w-9 place-items-center rounded-md text-dim hover:bg-down/10 hover:text-down disabled:opacity-30" aria-label={`Remove DCA level ${index + 1}`}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" onClick={() => setDcaLevels((current) => current.length < 6 ? [...current, { dropBps: 3000, buyAmountSol: 0.25 }] : current)} disabled={dcaLevels.length >= 6} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink disabled:opacity-40"><Plus size={14} /> Add DCA level</button>
                    <NumberField label="DCA expiration" value={dcaExpirationMinutes} onChange={(value) => setDcaExpirationMinutes(Math.round(value))} unit="min" step={30} min={30} max={10080} compact />
                  </div>
                </>
              )}
            </FormSection>
          )}

          <FormSection
            title="Execution and retries"
            description="Fine-tune route, fees, retry bounds, and cooldown."
            summary={`${entryMode} · ${(slippageBps / 100).toFixed(2)}% slippage · ${autoRetryCount} retries`}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField label="Entry mode" value={entryMode} onChange={(value) => setEntryMode(value as typeof entryMode)} options={[{ value: "market", label: "Market route" }, { value: "limit", label: "Limit entry" }]} />
              <NumberField label="Slippage cap" value={slippageBps / 100} onChange={(value) => setSlippageBps(Math.round(value * 100))} unit="%" step={0.25} min={0.01} max={20} />
              <SelectField label="Priority fee" value={priorityStrategy} onChange={(value) => setPriorityStrategy(value as typeof priorityStrategy)} options={[{ value: "economy", label: "Economy" }, { value: "auto", label: "Automatic" }, { value: "fast", label: "Fast" }]} />
              <NumberField label="Priority fee maximum" value={priorityFeeMax} onChange={(value) => setPriorityFeeMax(Math.round(value))} unit="lamports" step={100000} min={0} max={100000000} />
              <NumberField label="Auto retries" value={autoRetryCount} onChange={(value) => setAutoRetryCount(Math.round(value))} unit="tries" step={1} min={0} max={10} />
              <NumberField label="Limit retries" value={limitRetryCount} onChange={(value) => setLimitRetryCount(Math.round(value))} unit="tries" step={1} min={0} max={10} />
              <NumberField label="Quote expiration" value={quoteExpirationSeconds} onChange={(value) => setQuoteExpirationSeconds(Math.round(value))} unit="sec" step={5} min={5} max={300} />
              <NumberField label="Token cooldown" value={cooldownSeconds / 60} onChange={(value) => setCooldownSeconds(Math.round(value * 60))} unit="min" step={5} min={0} max={10080} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle label="Transaction simulation" detail="Reject the order when simulation is unavailable or fails." checked={simulationRequired} onChange={setSimulationRequired} />
              {kind === "discord" && <Toggle label="First call only" detail="Ignore repeat calls for the token during the cooldown." checked={firstCallOnly} onChange={setFirstCallOnly} />}
            </div>
          </FormSection>

          <FormSection
            title="Take profit"
            description={`${(tpAllocationBps / 100).toFixed(0)}% allocated · ${(100 - tpAllocationBps / 100).toFixed(0)}% remains`}
            summary={`${tpLevels.length} levels · first at +${(tpLevels[0]?.targetBps / 100 || 0).toFixed(0)}%`}
          >
            <div className="divide-y divide-edge rounded-md border border-edge">
              {tpLevels.map((level, index) => (
                <div key={index} className="grid gap-3 p-3 sm:grid-cols-[52px_repeat(3,minmax(0,1fr))_36px] sm:items-end">
                  <p className="font-mono text-xs text-dim sm:self-center">TP {index + 1}</p>
                  <label><span className="field-label">Target gain</span><span className="mt-1.5 block"><CompactNumber value={level.targetBps / 100} onChange={(value) => updateTp(index, { targetBps: Math.round(value * 100) })} suffix="%" /></span></label>
                  <label><span className="field-label">Sell allocation</span><span className="mt-1.5 block"><CompactNumber value={level.sellBps / 100} onChange={(value) => updateTp(index, { sellBps: Math.round(value * 100) })} suffix="%" /></span></label>
                  <label><span className="field-label">Trailing</span><span className="mt-1.5 block"><CompactNumber value={level.trailingBps / 100} onChange={(value) => updateTp(index, { trailingBps: Math.round(value * 100) })} suffix="%" disabled={!trailingTakeProfit} /></span></label>
                  <button type="button" onClick={() => setTpLevels((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={tpLevels.length === 1} className="grid h-9 w-9 place-items-center rounded-md text-dim hover:bg-down/10 hover:text-down disabled:opacity-30" aria-label={`Remove TP level ${index + 1}`}><X size={14} /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setTpLevels((current) => current.length < 5 ? [...current, { targetBps: 90000, sellBps: 1000, trailingBps: 0 }] : current)} disabled={tpLevels.length >= 5} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink disabled:opacity-40"><Plus size={14} /> Add TP level</button>
              <Toggle label="Trailing take profit" detail="Apply the per-level trailing distance after activation." checked={trailingTakeProfit} onChange={setTrailingTakeProfit} compact />
            </div>
            {tpAllocationBps > 10000 && <InlineError>Sell allocation exceeds 100%.</InlineError>}
          </FormSection>

          <FormSection
            title="Stop loss"
            description="Exit management continues when new entries are paused."
            summary={`-${(stopBps / 100).toFixed(1)}%${trailingStop ? " · trailing" : ""}${dynamicStop ? " · dynamic" : ""}`}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <NumberField label="Stop loss" value={stopBps / 100} onChange={(value) => setStopBps(Math.round(value * 100))} unit="%" step={0.5} min={0.01} max={100} />
              <NumberField label="Trigger debounce" value={stopDelaySeconds} onChange={(value) => setStopDelaySeconds(Math.round(value))} unit="sec" step={1} min={0} max={300} />
              <Toggle label="Trailing stop" detail="Move the stop upward with price." checked={trailingStop} onChange={setTrailingStop} />
              <Toggle label="Dynamic stop" detail="Use supported volatility evidence." checked={dynamicStop} onChange={setDynamicStop} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle label="Freeze token after stop" detail="Block re-entry until cooldown expires." checked={freezeAfterStop} onChange={setFreezeAfterStop} />
              <Toggle label="Emergency exit" detail="Use the best bounded route when the normal exit fails." checked={emergencyExit} onChange={setEmergencyExit} />
            </div>
          </FormSection>

          <FormSection
            title="Security filters"
            description="Only open this when you need to change the recommended safeguards."
            summary={`${Object.values(filters).filter((filter) => filter.enabled).length + Object.values(flags).filter(Boolean).length} checks enabled`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-edge bg-void px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-ink">Recommended protection is on</p>
                <p className="mt-1 text-[11px] leading-5 text-dim">Enabled checks fail closed when fresh evidence is unavailable.</p>
              </div>
              <button
                type="button"
                onClick={() => setSecurityOpen(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gold-400/50 px-4 text-xs font-semibold text-gold-400"
              >
                <ShieldCheck aria-hidden="true" size={14} />
                Configure filters
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-edge bg-void px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-ink">Current candidate preview</p>
                <p className="mt-1 text-[11px] text-dim">Informational only. Every live signal is checked again with fresh evidence.</p>
              </div>
              <button type="button" onClick={runPreview} disabled={previewing} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gold-400/50 px-4 text-xs font-semibold text-gold-400 disabled:opacity-50">
                <RefreshCw size={14} className={previewing ? "animate-spin" : ""} />
                Run preview
              </button>
            </div>
            {preview && (
              <div className="divide-y divide-edge rounded-md border border-edge">
                {preview.length === 0 && <p className="px-4 py-5 text-xs text-dim">No current candidates were returned by the live provider.</p>}
                {preview.slice(0, 12).map((item, index) => (
                  <div key={`${item.address}-${index}`} className="flex items-center gap-3 px-4 py-3">
                    <span className={`grid h-7 w-7 place-items-center rounded-sm ${item.pass ? "bg-up/10 text-up" : "bg-down/10 text-down"}`}>{item.pass ? <Check size={14} /> : <X size={14} />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-ink">{item.symbol}</p><p className="mt-0.5 truncate font-mono text-[9px] text-dim">{item.address}</p></div>
                    <p className={`max-w-[42%] text-right text-[10px] ${item.pass ? "text-up" : "text-down"}`}>{item.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </FormSection>
        </div>

        <aside className="h-fit overflow-hidden rounded-md border border-edge bg-panel xl:sticky xl:top-24">
          <header className="border-b border-edge px-5 py-4">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-gold-400">Configuration summary</p>
            <h2 className="mt-2 truncate text-base font-semibold text-ink">{name || "Untitled bot"}</h2>
          </header>
          <dl className="divide-y divide-edge px-5">
            <SummaryRow label="Product" value={kind === "discord" ? "Discord Bot" : "KOL Bot"} />
            <SummaryRow label="Source" value={kind === "discord" ? source?.name || "Not selected" : preset} />
            <SummaryRow label="Network" value={AUTOMATED_MAINNET_RELEASE.label} />
            <SummaryRow label="Wallet" value={walletAddress ? `${walletAddress.slice(0, 5)}...${walletAddress.slice(-4)}` : "Not connected"} />
            <SummaryRow label="Buy amount" value={`${buyAmountSol.toFixed(3)} SOL`} />
            <SummaryRow label="Maximum capital" value={`${maximumCapitalSol.toFixed(3)} SOL`} />
            <SummaryRow label="Open trades" value={String(maxOpenTrades)} />
            <SummaryRow label="TP allocation" value={`${(tpAllocationBps / 100).toFixed(0)}%`} />
            <SummaryRow label="Stop loss" value={`-${(stopBps / 100).toFixed(2)}%`} />
            <SummaryRow label="Slippage" value={`${(slippageBps / 100).toFixed(2)}%`} />
            <SummaryRow label="Creator fee" value={formatPercentBps(creatorFeeBps)} />
            <SummaryRow label="Platform fee" value={formatPercentBps(platformFeeBps)} />
            <SummaryRow label="Fee per entry" value={formatSol(creatorFeeLamports)} />
          </dl>
          <div className="border-t border-edge p-5">
            <div className={`rounded-md border px-3 py-2.5 text-[11px] leading-5 ${validationError ? "border-down/35 bg-down/5 text-down" : "border-up/30 bg-up/5 text-up"}`}>
              {validationError || "Configuration passes client validation. Server and scanner checks still apply."}
            </div>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled
                className="inline-flex min-h-11 cursor-not-allowed items-center justify-center gap-2 rounded-md border border-edge bg-void px-4 text-sm font-semibold text-dim opacity-70"
                title={AUTOMATED_MAINNET_RELEASE.reason}
              >
                <ShieldCheck size={15} />
                Automated trading not yet available
              </button>
              <button
                type="button"
                onClick={() => {
                  if (validationError) {
                    toast(validationError, "err");
                    return;
                  }
                  setConfirmReviewed(false);
                  setConfirmStatus("draft");
                }}
                disabled={saving}
                className="min-h-11 rounded-md border border-edge px-4 text-sm font-semibold text-ink disabled:opacity-40"
              >
                Review and save draft
              </button>
            </div>
            <p className="mt-3 text-center font-mono text-[9px] leading-4 text-dim">{AUTOMATED_MAINNET_RELEASE.reason}</p>
          </div>
        </aside>
      </div>

      {securityOpen && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4" onClick={() => setSecurityOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="security-filter-title"
            className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-md border border-edge bg-panel shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-edge bg-panel px-5 py-4">
              <div>
                <p className="font-mono text-[9px] uppercase text-gold-400">Advanced safeguards</p>
                <h2 id="security-filter-title" className="mt-2 text-lg font-semibold text-ink">Security filters</h2>
                <p className="mt-1 text-[11px] leading-5 text-dim">Disabled checks are listed in the final review. Enabled checks reject missing or stale evidence.</p>
              </div>
              <button type="button" onClick={() => setSecurityOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-edge text-dim" aria-label="Close security filters"><X size={16} /></button>
            </header>

            <div className="space-y-5 p-5">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div><h3 className="text-sm font-semibold text-ink">Core checks</h3><p className="mt-1 text-[11px] text-dim">Authority, metadata, liquidity, and transaction simulation evidence.</p></div>
                  <span className="font-mono text-[9px] text-dim">{Object.values(flags).filter(Boolean).length}/{FLAG_FILTERS.length} on</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {FLAG_FILTERS.map(([key, label, sourceLabel]) => (
                    <Toggle key={key} label={label} detail={sourceLabel} checked={flags[key]} onChange={(checked) => setFlags((current) => ({ ...current, [key]: checked }))} />
                  ))}
                </div>
              </section>

              <section className="overflow-hidden rounded-md border border-edge">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((current) => !current)}
                  aria-expanded={advancedOpen}
                  className="flex min-h-12 w-full items-center justify-between gap-3 bg-void px-4 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink">Range filters</span>
                    <span className="mt-0.5 block font-mono text-[9px] text-dim">{Object.values(filters).filter((filter) => filter.enabled).length} enabled · optional min/max evidence</span>
                  </span>
                  <ChevronDown aria-hidden="true" size={16} className={`shrink-0 text-dim transition ${advancedOpen ? "rotate-180" : ""}`} />
                </button>
                {advancedOpen && (
                  <div className="overflow-x-auto border-t border-edge">
                    <table className="w-full min-w-[780px] text-left">
                      <thead className="bg-void font-mono text-[9px] uppercase text-dim"><tr><th className="px-3 py-2.5">Filter</th><th className="px-3 py-2.5">Data source</th><th className="px-3 py-2.5">Minimum</th><th className="px-3 py-2.5">Maximum</th><th className="px-3 py-2.5">Required</th></tr></thead>
                      <tbody>
                        {FILTERS.map((definition) => {
                          const value = filters[definition.key];
                          return (
                            <tr key={definition.key} className="border-t border-edge">
                              <td className="px-3 py-3 text-xs font-medium text-ink">{definition.label}<span className="ml-1 font-mono text-[9px] text-dim">({definition.unit})</span></td>
                              <td className="px-3 py-3 font-mono text-[9px] text-dim">{definition.source}</td>
                              <td className="px-3 py-3"><CompactNumber value={value.min} onChange={(next) => setFilters((current) => ({ ...current, [definition.key]: { ...value, min: next } }))} suffix={definition.unit} disabled={!value.enabled} /></td>
                              <td className="px-3 py-3"><CompactNumber value={value.max} onChange={(next) => setFilters((current) => ({ ...current, [definition.key]: { ...value, max: next } }))} suffix={definition.unit} disabled={!value.enabled} /></td>
                              <td className="px-3 py-3"><button type="button" role="switch" aria-label={`Require ${definition.label}`} aria-checked={value.enabled} onClick={() => setFilters((current) => ({ ...current, [definition.key]: { ...value, enabled: !value.enabled } }))} className={`relative h-6 w-11 rounded-full transition ${value.enabled ? "bg-gold-400" : "bg-edge"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-void transition ${value.enabled ? "left-6" : "left-1"}`} /></button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-edge bg-panel px-5 py-4">
              <p className="font-mono text-[9px] text-dim">{Object.values(filters).filter((filter) => filter.enabled).length + Object.values(flags).filter(Boolean).length} total checks enabled</p>
              <button type="button" onClick={() => setSecurityOpen(false)} className="min-h-10 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c]">Done</button>
            </footer>
          </div>
        </div>
      )}

      {confirmStatus && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4" onClick={() => { setConfirmStatus(null); setConfirmReviewed(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-bot-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-edge bg-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-edge p-5">
              <div><p className="font-mono text-[9px] uppercase text-gold-400">Final confirmation</p><h2 id="confirm-bot-title" className="mt-2 text-lg font-semibold text-ink">{confirmStatus === "active" ? "Activate this bot?" : "Save this draft?"}</h2></div>
              <button type="button" onClick={() => { setConfirmStatus(null); setConfirmReviewed(false); }} className="grid h-9 w-9 place-items-center rounded-md border border-edge text-dim" aria-label="Close confirmation"><X size={16} /></button>
            </header>
            <div className="p-5">
              <div className="grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2">
                {[
                  ["Source", kind === "discord" ? `${source?.name || "Not selected"} · ${channelId ? source?.channels.find((channel) => channel.id === channelId)?.name || channelId : "All approved channels"}` : `${preset} scanner preset`],
                  ["Wallet", walletAddress || "Not connected"],
                  ["Entry", `${buyAmountSol} SOL · ${entryMode} · ${maxOpenTrades} maximum trades`],
                  ["Capital", `${maximumCapitalSol} SOL maximum · ${dailyLossSol} SOL daily loss limit`],
                  ["Take profit", tpLevels.map((level) => `+${level.targetBps / 100}% / sell ${level.sellBps / 100}%`).join(" · ")],
                  ["Stop loss", `-${stopBps / 100}%${trailingStop ? " · trailing" : ""}${dynamicStop ? " · dynamic" : ""}`],
                  ["Execution", `${slippageBps / 100}% slippage · ${priorityStrategy} priority up to ${priorityFeeMax.toLocaleString()} lamports`],
                  ["Retries", `${autoRetryCount} auto · ${limitRetryCount} limit · ${quoteExpirationSeconds}s quote`],
                  ["Cooldown", `${Math.round(cooldownSeconds / 60)} minutes${firstCallOnly ? " · first call only" : ""}`],
                  ["Security", `${Object.values(filters).filter((filter) => filter.enabled).length + Object.values(flags).filter(Boolean).length} enabled · missing data fails closed`],
                  ["Fees", `${formatPercentBps(platformFeeBps)} platform · ${formatPercentBps(creatorFeeBps)} creator`],
                  ["Worst-case planned exposure", `${maximumCapitalSol.toFixed(3)} SOL before network and route costs`]
                ].map(([label, value]) => (
                  <div key={label} className="bg-void p-3"><p className="field-label">{label}</p><p className="mt-1.5 break-words text-xs leading-5 text-ink">{value}</p></div>
                ))}
              </div>
              <div className="mt-4 flex gap-3 rounded-md border border-gold-400/35 bg-gold-400/5 p-3 text-xs leading-5 text-dim">
                <AlertTriangle className="mt-0.5 shrink-0 text-gold-400" size={16} />
                <p>Only signals that pass every selected filter are eligible. Saving this draft cannot move funds, and automated trading is not yet available.</p>
              </div>
              <label className="mt-4 flex items-start gap-3 text-xs text-ink">
                <input
                  type="checkbox"
                  required
                  checked={confirmReviewed}
                  onChange={(event) => setConfirmReviewed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#b98b5d]"
                  id="bot-confirm-check"
                />
                I reviewed the source, capital exposure, exits, retries, and fail-closed filters.
              </label>
            </div>
            <footer className="flex flex-col-reverse gap-2 border-t border-edge p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => { setConfirmStatus(null); setConfirmReviewed(false); }} className="min-h-11 rounded-md border border-edge px-5 text-sm font-semibold text-ink">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  if (!confirmReviewed) {
                    toast("Confirm that you reviewed the configuration.", "err");
                    return;
                  }
                  save(confirmStatus);
                }}
                disabled={saving || !confirmReviewed}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c] disabled:opacity-50"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {confirmStatus === "active" ? "Confirm and activate" : "Confirm and save draft"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

function FormSection({
  title,
  description,
  summary,
  defaultOpen = false,
  children
}: {
  title: string;
  description: string;
  summary?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="group bg-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-[68px] list-none items-center justify-between gap-4 px-5 py-3.5">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="mt-1 block text-[11px] leading-4 text-dim">{description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {summary && <span className="hidden max-w-56 truncate font-mono text-[9px] text-dim sm:block">{summary}</span>}
          <span className="grid h-8 w-8 place-items-center rounded-md border border-edge text-dim transition group-open:border-gold-400/40 group-open:text-gold-400">
            <ChevronDown aria-hidden="true" size={15} className="transition group-open:rotate-180" />
          </span>
        </span>
      </summary>
      <div className="space-y-4 border-t border-edge p-5">{children}</div>
    </details>
  );
}

function TextField({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} className="field-control mt-1.5 px-3" />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="field-control mt-1.5 px-3">
        {options.length === 0 && <option value="">No options available</option>}
        {options.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  step,
  min,
  max = 1_000_000_000,
  compact = false
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit: string;
  step: number;
  min: number;
  max?: number;
  compact?: boolean;
}) {
  const update = (next: number) => onChange(Math.min(max, Math.max(min, Number(next.toFixed(6)))));
  return (
    <label className={compact ? "block min-w-64" : "block"}>
      <span className="field-label">{label}</span>
      <span className="field-control mt-1.5 flex overflow-hidden">
        <button type="button" onClick={() => update(value - step)} className="grid h-11 w-10 shrink-0 place-items-center border-r border-edge text-dim hover:text-ink" aria-label={`Decrease ${label}`}><Minus size={13} /></button>
        <input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 appearance-none bg-transparent px-2 text-center font-mono text-xs outline-none [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="self-center pr-2 font-mono text-[9px] text-dim">{unit}</span>
        <button type="button" onClick={() => update(value + step)} className="grid h-11 w-10 shrink-0 place-items-center border-l border-edge text-dim hover:text-ink" aria-label={`Increase ${label}`}><Plus size={13} /></button>
      </span>
    </label>
  );
}

function CompactNumber({ value, onChange, suffix, disabled = false }: { value: number; onChange: (value: number) => void; suffix: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-9 min-w-36 items-center rounded-md border border-edge bg-void px-2 ${disabled ? "opacity-45" : "focus-within:border-gold-400"}`}>
      <input type="number" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none" />
      <span className="ml-2 font-mono text-[8px] text-dim">{suffix}</span>
    </label>
  );
}

function Toggle({ label, detail, checked, onChange, danger = false, compact = false }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void; danger?: boolean; compact?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`flex items-center justify-between gap-4 rounded-md border border-edge bg-void px-3 py-2.5 text-left ${compact ? "min-w-72" : "w-full"}`}>
      <span className="min-w-0"><span className={`block text-xs font-medium ${danger && checked ? "text-gold-400" : "text-ink"}`}>{label}</span><span className="mt-0.5 block text-[10px] leading-4 text-dim">{detail}</span></span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? danger ? "bg-gold-400" : "bg-up" : "bg-edge"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-void transition ${checked ? "left-6" : "left-1"}`} /></span>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 py-3"><dt className="text-[11px] text-dim">{label}</dt><dd className="max-w-[58%] text-right font-mono text-[10px] leading-4 text-ink">{value}</dd></div>;
}

function InlineError({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-2 rounded-md border border-down/35 bg-down/5 px-3 py-2 text-xs text-down"><AlertTriangle size={14} />{children}</p>;
}
