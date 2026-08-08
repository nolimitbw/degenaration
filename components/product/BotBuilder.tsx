"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/solana";
import {
  AlertTriangle,
  Check,
  ChevronDown,
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
import { NumericTextInput } from "@/components/product/NumericField";
import { DISCORD_CREATOR_BPS, KOL_CREATOR_BPS, bpsOf } from "@/lib/fee-model";
import { pendingNotice } from "@/lib/bot-control-contract";
import { displayState } from "@/lib/bot-states";
// One authoritative, integer-safe capital formula. Previously the builder computed this twice,
// inline, three hundred lines apart — and the two expressions disagreed, because only one of
// them counted DCA. See the header of lib/planned-capital.js.
import { plannedCapital, perTokenExposureError, format as lamportsToSol, explain } from "@/lib/planned-capital";

type TpLevel = { targetBps: number; sellBps: number; trailingBps: number; enabled: boolean };
type DcaLevel = { dropBps: number; buyAmountSol: number; enabled: boolean };
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
  ["sellSimulationRequired", "Successful sell simulation", "Transaction simulator"],
  // Reference parity (R3): the team paid for enhanced DEX listing info, a weak but real
  // legitimacy signal. The last filter from the reference set not already covered.
  ["dexPaid", "DEX listing paid", "DexScreener"]
] as const;

const PRESETS = {
  "Smart Money": { priceDropBps: 1200, lookbackMinutes: 60, riskTier: "high" },
  "High Volume": { priceDropBps: 1800, lookbackMinutes: 30, riskTier: "very-high" },
  "Top-10 Alpha": { priceDropBps: 1000, lookbackMinutes: 240, riskTier: "high" },
  "Last Alpha Calls": { priceDropBps: 1500, lookbackMinutes: 1440, riskTier: "high" }
} as const;

const PRESET_NAMES = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;

function numberOr(value: unknown, fallback: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isPresetName(value: unknown): value is keyof typeof PRESETS {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PRESETS, value);
}

function defaultFilters() {
  return Object.fromEntries(FILTERS.map((filter) => [filter.key, { enabled: ["liquidityUsd", "marketCapUsd", "top10HolderBps", "minimumRouteLiquidityUsd", "maximumPriceImpactBps"].includes(filter.key), min: filter.min, max: filter.max }])) as Record<string, FilterValue>;
}

// Security-critical flags default ON. These are legitimacy signals rather than safety
// checks, and requiring them by default would reject most newly launched tokens — so
// they are opt-in.
const OPT_IN_FLAGS = new Set<string>(["dexPaid"]);

function defaultFlags() {
  return Object.fromEntries(
    FLAG_FILTERS.map(([key]) => [key, !OPT_IN_FLAGS.has(key)])
  ) as Record<string, boolean>;
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
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState("");
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
  // Section 4: off by default, directly below Stop loss. Enforced in the claim by
  // supabase/degenaration-auto-reentry.sql, and distinct from firstCallOnly — that one is
  // about a repeat CALL, this one about a fresh entry after a POSITION has closed.
  const [autoReentry, setAutoReentry] = useState(false);
  const [tpLevels, setTpLevels] = useState<TpLevel[]>(kind === "discord"
    ? [{ targetBps: 10000, sellBps: 10000, trailingBps: 0, enabled: true }]
    : [
        { targetBps: 10000, sellBps: 5000, trailingBps: 0, enabled: true },
        { targetBps: 40000, sellBps: 2500, trailingBps: 0, enabled: true }
      ]);
  // Master switches. These are not decoration: an off take-profit persists zero levels and an
  // off stop loss persists stopBps 0, and server/engine/monitor.js already treats both as "no
  // such exit" — it filters levels through isProfitTarget and gates the stop on
  // `dropFraction > 0`. So the state the user sets is the state the worker enforces.
  // The three masters. Unlike the section switches below these are not about one exit rule —
  // they govern whether the bot may act at all, and each is enforced at the point it matters:
  // auto-entry and the emergency stop inside worker_claim_call_execution, auto-exit inside the
  // exit monitor. See supabase/degenaration-bot-entry-limits.sql and server/engine/monitor.js.
  /**
   * The switch layer for the numeric limits.
   *
   * Each limit keeps its number at all times: `subscriber_config_valid` requires several of
   * them to be present and numeric, so "off" cannot be expressed by clearing the field. The
   * flag is what the claim reads, and absent reads as ON so an existing bot keeps the limit
   * its owner typed.
   */
  const [limits, setLimits] = useState({
    maxOpenTrades: true,
    maximumCapital: true,
    dailyLoss: true,
    perTokenExposure: true,
    cooldown: true,
    priorityFee: true
  });
  const setLimit = (key: keyof typeof limits, on: boolean) =>
    setLimits((current) => ({ ...current, [key]: on }));
  const [autoEntry, setAutoEntry] = useState(true);
  const [autoExit, setAutoExit] = useState(true);
  const [killSwitch, setKillSwitch] = useState(false);
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(true);
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
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
    { dropBps: 1000, buyAmountSol: 0.25, enabled: true },
    { dropBps: 2000, buyAmountSol: 0.25, enabled: true }
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
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(botId));
  const [confirmStatus, setConfirmStatus] = useState<"draft" | "active" | null>(null);
  const [confirmReviewed, setConfirmReviewed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [readiness, setReadiness] = useState<{ ready: boolean; reason: string | null; blocking: string | null } | null>(null);
  const [walletAvailableLamports, setWalletAvailableLamports] = useState<string | null>(null);

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

  const loadSources = useCallback(() => {
    if (kind !== "discord") return;
    setSourcesError("");
    setSourcesLoading(true);
    productFetch<{ sources: DiscordSource[] }>(
      "/api/product/marketplace/discord?period=7d&sort=performance",
      undefined,
      { signal: AbortSignal.timeout(15000) }
    )
      .then((data) => {
        setSources(data.sources || []);
        setSourceId((current) => current || data.sources?.[0]?.id || "");
      })
      .catch((reason) => {
        // Previously `.catch(() => setSources([]))`. A failed load then rendered as
        // "No options available", which is indistinguishable from "no approved sources
        // exist" — so the primary creation flow looked broken with no cause and no retry.
        // Observed in the owner's recording: the marketplace listed two approved sources
        // while this dropdown showed none.
        setSources([]);
        // The raw API reason ("server not configured", provider codes) is internal
        // language that must not reach the public UI (spec §23). Show a product-language
        // message and keep the detail in the console for support.
        console.error("[bot-builder] approved source load failed:", reason);
        setSourcesError("Approved sources could not be loaded right now.");
      })
      .finally(() => setSourcesLoading(false));
  }, [kind]);

  useEffect(() => { loadSources(); }, [loadSources]);

  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setWalletAvailableLamports(null);
      return;
    }
    productFetch<{ spendableLamports?: string }>(
      `/api/product/portfolio/withdraw?wallet=${encodeURIComponent(walletAddress)}`,
      { getAccessToken }
    )
      .then((state) => setWalletAvailableLamports(state.spendableLamports || null))
      .catch(() => setWalletAvailableLamports(null));
  }, [authenticated, getAccessToken, walletAddress]);

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
        setBuyAmountSol(numberOr(config.buyAmountLamports, 500_000_000) / 1e9);
        setMaximumCapitalSol(numberOr(config.maximumCapitalLamports, 3_000_000_000) / 1e9);
        setDailyLossSol(numberOr(config.dailyLossLimitLamports, 1_000_000_000) / 1e9);
        setPerTokenSol(numberOr(config.perTokenExposureLamports, 1_000_000_000) / 1e9);
        setMaxOpenTrades(numberOr(config.maxOpenTrades, 3));
        setEntryMode(config.entryMode === "limit" ? "limit" : "market");
        setSlippageBps(numberOr(config.slippageBps, 300));
        setPriorityStrategy(config.priorityFeeStrategy || "auto");
        setPriorityFeeMax(numberOr(config.priorityFeeMaxLamports, 500_000));
        setAutoRetryCount(numberOr(config.autoRetryCount, 0));
        setLimitRetryCount(numberOr(config.limitRetryCount, 0));
        setQuoteExpirationSeconds(numberOr(config.quoteExpirationSeconds, 30));
        setCooldownSeconds(numberOr(config.cooldownSeconds, 900));
        setSimulationRequired(config.simulationRequired !== false);
        setFirstCallOnly(Boolean(config.firstCallOnly));
        // A saved bot with no autoReentry key predates the control, and the claim reads its
        // absence as ON. Hydrating it as `false` here would show the owner an OFF switch for a
        // bot that behaves as ON — the editor lying about the running configuration.
        setAutoReentry(config.autoReentry === undefined ? true : Boolean(config.autoReentry));
        if (Array.isArray(config.takeProfit?.levels)) {
          setTpLevels(config.takeProfit.levels.map((level: Partial<TpLevel>) => ({
            targetBps: numberOr(level.targetBps, 10000),
            sellBps: numberOr(level.sellBps, 1000),
            trailingBps: numberOr(level.trailingBps, 0),
            // A saved level with no explicit flag predates per-level switches and was, by
            // definition, active — defaulting it to off would silently disable exits on every
            // existing bot the first time its owner opened the editor.
            enabled: level.enabled !== false
          })));
        }
        // Absent means a bot saved before these existed, and such a bot was automating both
        // sides. Defaulting them off would silently stop live bots the first time their owner
        // opened the editor; the emergency stop is the opposite and defaults off.
        setLimits((current) => ({
          maxOpenTrades: config.limits?.maxOpenTrades !== false,
          maximumCapital: config.limits?.maximumCapital !== false,
          dailyLoss: config.limits?.dailyLoss !== false,
          perTokenExposure: config.limits?.perTokenExposure !== false,
          cooldown: config.limits?.cooldown !== false,
          priorityFee: config.limits?.priorityFee !== false,
          ...(config.limits && typeof config.limits === "object" ? {} : current)
        }));
        setAutoEntry(config.autoEntry !== false);
        setAutoExit(config.autoExit !== false);
        setKillSwitch(Boolean(config.killSwitch));
        setTrailingTakeProfit(Boolean(config.takeProfit?.trailing));
        setTakeProfitEnabled(config.takeProfit?.enabled !== false);
        setStopLossEnabled(config.stopLoss?.enabled !== false);
        setStopBps(numberOr(config.stopLoss?.stopBps, 4000));
        setTrailingStop(Boolean(config.stopLoss?.trailing));
        setDynamicStop(Boolean(config.stopLoss?.dynamic));
        setStopDelaySeconds(numberOr(config.stopLoss?.delaySeconds, 5));
        setFreezeAfterStop(config.stopLoss?.freezeAfterStop !== false);
        setEmergencyExit(config.stopLoss?.emergencyExit !== false);
        setVisibility(bot.visibility || "private");
        setManualMints(Array.isArray(config.manualMints) ? config.manualMints.join("\n") : "");
        setPriceDropBps(numberOr(config.trigger?.priceDropBps, 1200));
        setReferenceMode(config.trigger?.referenceMode === "moving-average" ? "moving-average" : "recent-ath");
        setLookbackMinutes(numberOr(config.trigger?.lookbackMinutes, 60));
        setDcaEnabled(Boolean(config.dca?.enabled));
        if (Array.isArray(config.dca?.levels)) {
          setDcaLevels(config.dca.levels.map((level: Partial<DcaLevel>) => ({
            dropBps: numberOr(level.dropBps, 1000),
            buyAmountSol: numberOr(level.buyAmountSol, 0.25),
            // A saved level with no explicit flag predates per-level switches and was, by
            // definition, active. The take-profit levels take the same reading, for the same
            // reason: defaulting to off would silently disable staged entries on every
            // existing bot the first time its owner opened the editor.
            enabled: level.enabled !== false
          })));
        }
        setDcaExpirationMinutes(numberOr(config.dca?.expirationMinutes, 240));
        if (isPresetName(config.scanner?.preset)) setPreset(config.scanner.preset);
        setAutoRefreshMinutes(numberOr(config.scanner?.autoRefreshMinutes, 15));
        setPreviewCount(numberOr(config.scanner?.previewCount, 10));
        setDegenMode(Boolean(config.scanner?.degenMode));
        setRiskTier(config.riskTier || "high");
        if (config.safetyFilters?.ranges) setFilters((current) => ({ ...current, ...config.safetyFilters.ranges }));
        if (config.safetyFilters?.flags) setFlags((current) => ({ ...current, ...config.safetyFilters.flags }));
      })
      .catch((reason) => toast(reason instanceof Error ? reason.message : "Could not load bot", "err"))
      .finally(() => setLoading(false));
  }, [authenticated, botId, getAccessToken, toast]);

  const source = sources.find((item) => item.id === sourceId);
  const tpAllocationBps = takeProfitEnabled
    ? tpLevels.filter((level) => level.enabled).reduce((total, level) => total + level.sellBps, 0)
    : 0;
  const capitalPlan = plannedCapital({
    buyAmountSol,
    maxOpenTrades,
    dca: { enabled: dcaEnabled, levels: dcaLevels },
    perTokenExposureSol: perTokenSol
  });
  const dcaCapital = capitalPlan.dcaSol;
  const requiredCapital = capitalPlan.plannedSol;
  const exposureError = perTokenExposureError(capitalPlan, { enabled: limits.perTokenExposure });
  const enabledSafetyCount = Object.values(filters).filter((filter) => filter.enabled).length + Object.values(flags).filter(Boolean).length;
  const totalSafetyCount = FILTERS.length + FLAG_FILTERS.length;
  const creatorFeeBps = kind === "discord" ? source?.creatorFeeBps ?? DISCORD_CREATOR_BPS : KOL_CREATOR_BPS;
  // Was hard-coded to 0, so the builder told users the platform fee was 0.00% while the
  // swap routes were charging 200 bps. The real rate comes from the server, which
  // reports 0 only while PLATFORM_FEE_ACCOUNT is unset.
  const [platformFeeBps, setPlatformFeeBps] = useState(0);
  useEffect(() => {
    productFetch<{ platformFeeBps?: number }>("/api/platform/config")
      .then((config) => setPlatformFeeBps(Number(config?.platformFeeBps) || 0))
      .catch(() => setPlatformFeeBps(0));
  }, []);
  const platformFeeLamports = useMemo(
    () => bpsOf(solToLamports(buyAmountSol), platformFeeBps),
    [buyAmountSol, platformFeeBps]
  );

  const validationError = useMemo(() => {
    if (!name.trim() || name.trim().length > 80) return "Bot name must be 1 to 80 characters.";
    if (kind === "discord" && !sourceId) return "Select an approved Discord source.";
    if (!(buyAmountSol > 0 && buyAmountSol <= 100)) return "Buy amount must be between 0 and 100 SOL.";
    if (maxOpenTrades < 1 || maxOpenTrades > 100) return "Maximum open trades must be 1 to 100.";
    if (limits.maximumCapital && maximumCapitalSol < requiredCapital) {
      return `Maximum capital must cover at least ${lamportsToSol(capitalPlan.plannedLamports)} SOL.`;
    }
    if (dailyLossSol <= 0 || dailyLossSol < buyAmountSol) return "Max funds per day must cover at least one trade.";
    // The per-token limit is measured against what ONE POSITION plans to commit, not against
    // the bare entry. A limit that covers the entry but not the entry plus its DCA legs leaves
    // every position half-built: the entry claims, then the first leg that crosses the limit is
    // refused. The shipped defaults produced exactly that — 0.50 per token, 0.55 per position.
    if (exposureError) return exposureError;
    if (limits.perTokenExposure && limits.maximumCapital && perTokenSol > maximumCapitalSol) {
      return "Per-token exposure must remain inside maximum capital.";
    }
    const enabledTpLevels = tpLevels.filter((level) => level.enabled);
    if (takeProfitEnabled && tpAllocationBps > 10000) return "Take-profit sell allocations cannot exceed 100%.";
    if (takeProfitEnabled && (enabledTpLevels.length === 0 || enabledTpLevels.some((level) => level.targetBps <= 0 || level.sellBps <= 0))) return "Take-profit targets and allocations must be positive.";
    if (takeProfitEnabled && enabledTpLevels.some((level, index) => index > 0 && level.targetBps <= enabledTpLevels[index - 1].targetBps)) return "Take-profit targets must increase from one level to the next.";
    if (stopLossEnabled && (stopBps <= 0 || stopBps > 10000)) return "Stop loss must be between 0.01% and 100%.";
    if (kind === "kol" && dcaEnabled) {
      if (dcaLevels.length < 1 || dcaLevels.some((level) => level.dropBps <= 0 || level.buyAmountSol <= 0)) return "DCA levels need a positive drop and buy amount.";
      if (dcaLevels.some((level, index) => index > 0 && level.dropBps <= dcaLevels[index - 1].dropBps)) return "DCA drops must increase from one level to the next.";
      if (buyAmountSol + dcaCapital > maximumCapitalSol) return "Entry plus DCA capital exceeds the maximum.";
    }
    const invalidRange = FILTERS.find((definition) => {
      const value = filters[definition.key];
      return value?.enabled && value.max > 0 && value.min > value.max;
    });
    if (invalidRange) return `${invalidRange.label} minimum cannot exceed its maximum.`;
    if (slippageBps < 1 || slippageBps > 2000) return "Slippage must be between 0.01% and 20%.";
    return null;
  }, [buyAmountSol, capitalPlan, dailyLossSol, dcaCapital, dcaEnabled, dcaLevels, exposureError, filters, kind, limits, maxOpenTrades, maximumCapitalSol, name, perTokenSol, requiredCapital, slippageBps, sourceId, stopBps, stopLossEnabled, takeProfitEnabled, tpAllocationBps, tpLevels]);

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
    setPreviewError("");
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
    } catch (reason) {
      console.error("[bot-builder] candidate preview failed:", reason);
      setPreviewError("Current candidates could not be loaded right now.");
    } finally {
      setPreviewing(false);
    }
  }

  function buildConfig() {
    return {
      walletAddress,
      walletId,
      channelId: channelId || null,
      autoEntry,
      autoExit,
      killSwitch,
      // Spelled out rather than spread, so check:bot-control-contract sees one path per switch
      // and each has to name the reader that enforces it. A spread would declare as a single
      // opaque "limits" and let a new switch in silently.
      limits: {
        maxOpenTrades: limits.maxOpenTrades,
        maximumCapital: limits.maximumCapital,
        dailyLoss: kind === "discord" ? true : limits.dailyLoss,
        perTokenExposure: limits.perTokenExposure,
        cooldown: limits.cooldown,
        priorityFee: limits.priorityFee
      },
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
      autoReentry,
      // An off module is persisted as ABSENT, not as a flag alongside live values. The worker
      // reads levels and stopBps; leaving populated levels behind an `enabled: false` it does
      // not check would keep selling while the user believes take profit is off.
      takeProfit: {
        enabled: takeProfitEnabled,
        trailing: trailingTakeProfit,
        levels: takeProfitEnabled ? tpLevels.filter((level) => level.enabled) : []
      },
      stopLoss: {
        enabled: stopLossEnabled,
        stopBps: stopLossEnabled ? Math.round(stopBps) : 0,
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
        // An off level is persisted as ABSENT, the same rule the take-profit levels follow:
        // leaving a disabled level in the list behind a flag nothing checks is how a switched-
        // off control keeps buying.
        levels: dcaLevels.filter((level) => level.enabled),
        expirationMinutes: Math.round(dcaExpirationMinutes),
        maximumEntries: dcaLevels.filter((level) => level.enabled).length
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

  /**
   * `RUN` asks the SERVER whether this bot can activate, and shows the one reason it cannot.
   *
   * The three strings this replaces — "Configuration passes client validation…", "Activation
   * needs trading enabled", "Activation needs the execution worker" — were all computed here,
   * on the client, from a frozen constant. So they said the same sentence to a user with no
   * wallet, a user with no capital, and a user whose only problem was the fee account. A
   * message that cannot vary is not a diagnosis, and that is why they are gone rather than
   * reworded.
   */
  async function checkReadiness() {
    setChecking(true);
    setReadiness(null);
    try {
      const verdict = await productFetch<{ ready: boolean; reason: string | null; blocking: string | null }>(
        "/api/product/bots/readiness",
        { getAccessToken, identityToken },
        { method: "POST", body: JSON.stringify(activationPayload()) }
      );
      setReadiness(verdict);
      return verdict;
    } catch (reason) {
      // Fail closed and say so. Reporting "ready" because the check itself failed is the one
      // outcome that must never happen here.
      const verdict = {
        ready: false,
        reason: reason instanceof Error ? reason.message : "Readiness could not be checked.",
        blocking: "operator" as const
      };
      setReadiness(verdict);
      return verdict;
    } finally {
      setChecking(false);
    }
  }

  async function run() {
    if (!authenticated) { login(); return; }
    if (validationError) { toast(validationError, "err"); return; }
    const verdict = await checkReadiness();
    if (!verdict.ready) {
      toast(verdict.reason || "This bot cannot run yet.", "err");
      return;
    }
    setConfirmReviewed(false);
    setConfirmStatus("active");
  }

  function activationPayload() {
    return {
      id: botId,
      kind,
      name: name.trim(),
      description: description.trim(),
      status: "active",
      visibility: kind === "discord" ? "private" : visibility,
      executionMode: "solana-mainnet",
      sourceId: kind === "discord" ? sourceId : null,
      sourceGroupId: kind === "discord" ? sourceId : null,
      confirmed: true,
      config: buildConfig()
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

  // Draft / Validated / Ready, derived — never stored. Storing "Ready" would freeze a verdict
  // that goes stale the moment the worker, the fee account or the balance changes, and the
  // user would be told to press RUN on something that cannot run. See lib/bot-states.js.
  const stateLabel = displayState(botId ? "draft" : "draft", readiness
    ? { ready: readiness.ready, checks: readiness.ready ? [] : [{ blocking: readiness.blocking, ok: false }] }
    : null).label;

  // Controls this bot kind saves that no execution path reads yet, from the one contract the
  // build gate checks. Rendering them from the same list is what keeps the notice honest:
  // implementing a control and forgetting to update the note fails check:bot-control-contract.
  const pendingFor = (section: string) => pendingNotice(kind, section);

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-px overflow-hidden rounded-md border border-edge bg-edge">
          <FormSection
            title="Bot identity"
            pending={pendingFor("identity")}
            description="Name this setup before choosing where it trades."
            summary={name || "Name required"}
            defaultOpen
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <TextField label="Bot name" value={name} onChange={setName} maxLength={80} />
              {kind === "kol" && (
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
          </FormSection>

          <FormSection
            title="Execution wallet"
            pending={pendingFor("wallet")}
            description="Use the verified Solana wallet that owns this bot's trades."
            summary={walletAddress ? `${walletAddress.slice(0, 5)}...${walletAddress.slice(-4)}` : "Wallet required to activate"}
            defaultOpen
          >
            <div className="flex flex-col gap-4 rounded-md border border-edge bg-void px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="field-label">Selected wallet</p>
                <p className="mt-2 truncate font-mono text-sm text-ink">{walletAddress || "Not connected"}</p>
                <p className={`mt-1 text-[11px] ${delegated ? "text-up" : "text-gold-400"}`}>{delegated ? "Delegated execution enabled" : "Delegation required to activate"}</p>
              </div>
              {!walletAddress && (
                <button
                  type="button"
                  onClick={setupWallet}
                  disabled={walletCreating}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-gold-400/45 px-3 text-xs font-semibold text-gold-400 disabled:opacity-50"
                >
                  {walletCreating ? <Loader2 aria-hidden="true" size={14} className="animate-spin" /> : <WalletCards aria-hidden="true" size={14} />}
                  {authenticated ? "Create Solana wallet" : "Connect account"}
                </button>
              )}
            </div>
          </FormSection>

          {kind === "discord" && (
            <FormSection
              title="Discord source"
            pending={pendingFor("source")}
              description="Choose an approved server and either one channel or all approved channels."
              summary={source?.name || "Source required"}
              defaultOpen
            >
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <SelectField
                    label="Approved Discord server"
                    userContent
                    value={sourceId}
                    onChange={(value) => {
                      setSourceId(value);
                      setChannelId("");
                    }}
                    options={sources.map((item) => ({ value: item.id, label: item.name }))}
                  />
                  {sourcesLoading && <p className="mt-1.5 text-[11px] text-dim">Loading approved sources…</p>}
                  {!sourcesLoading && sourcesError && (
                    <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-danger">
                      {sourcesError}
                      <button type="button" onClick={loadSources} className="inline-flex min-h-8 items-center rounded border border-edge px-2 font-semibold text-ink">Try again</button>
                    </p>
                  )}
                  {!sourcesLoading && !sourcesError && sources.length === 0 && (
                    <p className="mt-1.5 text-[11px] text-dim">No approved sources yet. Browse Discord Sources to see communities awaiting approval.</p>
                  )}
                </div>
                <SelectField
                  label="Discord channel"
                  userContent
                  value={channelId}
                  onChange={setChannelId}
                  options={[{ value: "", label: "All approved channels" }, ...(source?.channels || []).map((channel) => ({ value: channel.id, label: channel.name || channel.id }))]}
                />
              </div>
              <div className="grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-3">
                <SourceStat label="Measured calls" value={source ? String(source.measuredCalls) : "--"} />
                <SourceStat label="2x rate" value={source?.winRate == null ? "Collecting data" : `${source.winRate.toFixed(1)}%`} />
                <SourceStat label="Creator share" value={formatPercentBps(creatorFeeBps)} />
              </div>
            </FormSection>
          )}

          <FormSection
            title={kind === "discord" ? "Margin amount per trade" : "Buy amount"}
            pending={pendingFor("funding")}
            description="How much this bot spends per entry."
            summary={`${buyAmountSol.toFixed(2)} SOL per entry · ${maxOpenTrades} open max`}
            defaultOpen
          >
            {kind === "kol" && <div className="grid gap-3 sm:grid-cols-3">
              <Toggle label="Automatic entries" detail="Open new positions from this source's calls." checked={autoEntry} onChange={setAutoEntry} compact disabled={killSwitch} />
              <Toggle label="Automatic exits" detail="Run take profit, stop loss and trailing without you." checked={autoExit} onChange={setAutoExit} compact disabled={killSwitch} />
              <Toggle label="Emergency stop" detail="Refuse every new entry. Open positions still exit." checked={killSwitch} onChange={setKillSwitch} compact danger />
            </div>}
            {killSwitch && (
              <p role="status" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[11px] text-ink">
                Emergency stop is on. This bot will not open a new position, and its open positions keep exiting.
              </p>
            )}
            {/* Buy amount is the one funding control section 4 keeps on the first screen. The
                four exposure limits move into the collapsed group below it — they are real and
                enforced, but a beginner does not have to answer them to start. */}
            <NumberField label={kind === "discord" ? "Margin amount per trade" : "Buy amount"} value={buyAmountSol} onChange={setBuyAmountSol} unit="SOL" step={0.1} min={0.01} />
            <div className="flex flex-wrap gap-2">
              {[0.1, 0.5, 1, 5].map((amount) => (
                <button key={amount} type="button" onClick={() => setBuyAmountSol(amount)} className={`min-h-11 sm:min-h-9 rounded-md border px-3 font-mono text-xs ${buyAmountSol === amount ? "border-gold-400 bg-gold-400/10 text-gold-400" : "border-edge text-dim hover:text-ink"}`}>{amount} SOL</button>
              ))}
            </div>
            {kind === "discord" && (
              <>
                <NumberField label="Max funds per day" value={dailyLossSol} onChange={setDailyLossSol} unit="SOL" step={0.1} min={0.01} />
                <p className="text-[11px] leading-5 text-dim">Once this budget is used, new entries wait for the next UTC reset. Exits continue.</p>
                <div className="grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2">
                  <SourceStat label="Wallet available" value={walletAvailableLamports == null ? "Unavailable" : `${lamportsToSol(BigInt(walletAvailableLamports))} SOL`} />
                  <SourceStat label="Estimated max exposure" value={`${lamportsToSol(
                    limits.maximumCapital && capitalPlan.plannedLamports > BigInt(Math.round(maximumCapitalSol * 1e9))
                      ? BigInt(Math.round(maximumCapitalSol * 1e9))
                      : capitalPlan.plannedLamports
                  )} SOL`} />
                </div>
              </>
            )}
            {kind === "kol" && <details className="group rounded-md border border-edge bg-void">
              <summary className="flex min-h-11 list-none items-center justify-between gap-3 px-3">
                <span>
                  <span className="block text-xs font-medium text-ink">Exposure limits</span>
                  <span className="mt-0.5 block font-mono text-[9px] text-dim">{maximumCapitalSol.toFixed(2)} SOL cap · {maxOpenTrades} open · {dailyLossSol.toFixed(2)} SOL daily · {perTokenSol.toFixed(2)} SOL per token</span>
                </span>
                <ChevronDown aria-hidden="true" size={15} className="text-dim transition group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 border-t border-edge p-3 sm:grid-cols-2">
                <LimitField label="Maximum capital" on={limits.maximumCapital} onToggle={(on) => setLimit("maximumCapital", on)}>
                  <NumberField label="Maximum capital" hideLabel value={maximumCapitalSol} onChange={setMaximumCapitalSol} unit="SOL" step={0.5} min={0.1} disabled={!limits.maximumCapital} />
                </LimitField>
                <LimitField label="Maximum open trades" on={limits.maxOpenTrades} onToggle={(on) => setLimit("maxOpenTrades", on)}>
                  <NumberField label="Maximum open trades" hideLabel value={maxOpenTrades} onChange={(value) => setMaxOpenTrades(Math.round(value))} unit="trades" step={1} min={1} max={100} disabled={!limits.maxOpenTrades} />
                </LimitField>
                <LimitField label="Daily loss limit" on={limits.dailyLoss} onToggle={(on) => setLimit("dailyLoss", on)}>
                  <NumberField label="Daily loss limit" hideLabel value={dailyLossSol} onChange={setDailyLossSol} unit="SOL" step={0.1} min={0.01} disabled={!limits.dailyLoss} />
                </LimitField>
                <LimitField label="Per-token exposure" on={limits.perTokenExposure} onToggle={(on) => setLimit("perTokenExposure", on)}>
                  <NumberField label="Per-token exposure" hideLabel value={perTokenSol} onChange={setPerTokenSol} unit="SOL" step={0.1} min={0.01} disabled={!limits.perTokenExposure} />
                </LimitField>
              </div>
            </details>}
            {/* The working, not just the total. A figure with no derivation is unfalsifiable: a
                user who thought 5.50 was wrong had nothing to check it against, and the
                "maximum exposure" row beside it said 0.50 for the same configuration. */}
            {kind === "kol" && <div className="rounded-md border border-edge bg-void px-4 py-3">
              <p className="field-label">Minimum planned capital</p>
              <div className="mt-2 space-y-0.5 font-mono text-xs text-dim">
                {explain(capitalPlan).map((line, index) => (
                  <p key={index} className={line.startsWith("=") ? "text-ink" : undefined}>{line}</p>
                ))}
              </div>
              <p className="mt-2 border-t border-edge pt-2 text-[11px] text-dim">
                Take profit and stop loss are not counted — they close a position, they do not fund one.
                Keep about {lamportsToSol(capitalPlan.reserveLamports)} SOL on top for network fees and rent;
                that reserve is not trading capital.
              </p>
            </div>}
          </FormSection>






          <FormSection
            title="Take profit"
            pending={pendingFor("takeProfit")}
            description={`${(tpAllocationBps / 100).toFixed(0)}% allocated · ${(100 - tpAllocationBps / 100).toFixed(0)}% remains`}
            defaultOpen
            summary={takeProfitEnabled
              ? `${tpLevels.filter((level) => level.enabled).length} of ${tpLevels.length} levels on`
              : "Off"}
          >
            <Toggle
              label="Take profit"
              detail="Off saves no levels at all, so nothing sells into strength."
              checked={takeProfitEnabled}
              onChange={setTakeProfitEnabled}
            />
            {kind === "discord" && takeProfitEnabled && (
              <NumberField label="Target profit" value={(tpLevels[0]?.targetBps || 10000) / 100} onChange={(value) => updateTp(0, { targetBps: Math.round(value * 100), sellBps: 10000, enabled: true })} unit="%" step={1} min={0.01} max={1000} />
            )}
            {kind === "kol" && <div className={`divide-y divide-edge rounded-md border border-edge ${takeProfitEnabled ? "" : "opacity-45"}`}>
              {tpLevels.map((level, index) => (
                <div key={index} className="grid gap-3 p-3 sm:grid-cols-[92px_repeat(3,minmax(0,1fr))_36px] sm:items-end">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={level.enabled}
                    aria-label={`Take-profit level ${index + 1}`}
                    disabled={!takeProfitEnabled}
                    onClick={() => updateTp(index, { enabled: !level.enabled })}
                    className="flex min-h-11 items-center gap-2 text-left sm:min-h-0 sm:self-center disabled:opacity-40"
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${level.enabled && takeProfitEnabled ? "bg-up" : "bg-edge"}`} />
                    <span className="font-mono text-xs text-dim">TP {index + 1}</span>
                    <span className={`font-mono text-[9px] uppercase ${level.enabled && takeProfitEnabled ? "text-up" : "text-dim"}`}>
                      {level.enabled ? "On" : "Off"}
                    </span>
                  </button>
                  <label><span className="field-label">Target gain</span><span className="mt-1.5 block"><CompactNumber ariaLabel={`TP ${index + 1} target gain`} value={level.targetBps / 100} onChange={(value) => updateTp(index, { targetBps: Math.round(value * 100) })} suffix="%" disabled={!takeProfitEnabled || !level.enabled} /></span></label>
                  <label><span className="field-label">Sell allocation</span><span className="mt-1.5 block"><CompactNumber ariaLabel={`TP ${index + 1} sell allocation`} value={level.sellBps / 100} onChange={(value) => updateTp(index, { sellBps: Math.round(value * 100) })} suffix="%" disabled={!takeProfitEnabled || !level.enabled} /></span></label>
                  <label><span className="field-label">Trailing</span><span className="mt-1.5 block"><CompactNumber ariaLabel={`TP ${index + 1} trailing distance`} value={level.trailingBps / 100} onChange={(value) => updateTp(index, { trailingBps: Math.round(value * 100) })} suffix="%" disabled={!trailingTakeProfit || !takeProfitEnabled || !level.enabled} /></span></label>
                  <button type="button" onClick={() => setTpLevels((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={tpLevels.length === 1} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md text-dim hover:bg-down/10 hover:text-down disabled:opacity-30" aria-label={`Remove TP level ${index + 1}`}><X size={14} /></button>
                </div>
              ))}
            </div>}
            {kind === "kol" && <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={() => setTpLevels((current) => current.length < 5 ? [...current, { targetBps: 90000, sellBps: 1000, trailingBps: 0, enabled: true }] : current)} disabled={tpLevels.length >= 5} className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink disabled:opacity-40"><Plus size={14} /> Add TP level</button>
              <Toggle label="Trailing take profit" detail="Apply the per-level trailing distance after activation." checked={trailingTakeProfit} onChange={setTrailingTakeProfit} compact disabled={!takeProfitEnabled} />
            </div>}
            {tpAllocationBps > 10000 && <InlineError>Sell allocation exceeds 100%.</InlineError>}
          </FormSection>
          <FormSection
            title="Stop loss"
            pending={pendingFor("stopLoss")}
            description="Exit management continues when new entries are paused."
            defaultOpen
            summary={stopLossEnabled
              ? `-${(stopBps / 100).toFixed(1)}%${trailingStop ? " · trailing" : ""}${dynamicStop ? " · dynamic" : ""}`
              : "Off"}
          >
            <Toggle
              label="Stop loss"
              detail="Off saves no stop, so a position has no downside exit until you close it."
              checked={stopLossEnabled}
              onChange={setStopLossEnabled}
              danger
            />
            {!stopLossEnabled && (
              <InlineError>
                With stop loss off nothing closes a losing position automatically. Exits still run for take-profit levels you leave on.
              </InlineError>
            )}
            {stopLossEnabled && kind === "discord" && <NumberField label="Loss limit" value={stopBps / 100} onChange={(value) => setStopBps(Math.round(value * 100))} unit="%" step={0.5} min={0.01} max={100} />}
            {kind === "kol" && <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-4 ${stopLossEnabled ? "" : "opacity-45"}`}>
              <NumberField label="Stop loss" value={stopBps / 100} onChange={(value) => setStopBps(Math.round(value * 100))} unit="%" step={0.5} min={0.01} max={100} disabled={!stopLossEnabled} />
              <NumberField label="Trigger debounce" value={stopDelaySeconds} onChange={(value) => setStopDelaySeconds(Math.round(value))} unit="sec" step={1} min={0} max={300} disabled={!stopLossEnabled} />
              <Toggle label="Trailing stop" detail="Move the stop upward with price." checked={trailingStop} onChange={setTrailingStop} disabled={!stopLossEnabled} />
              <Toggle label="Dynamic stop" detail="Use supported volatility evidence." checked={dynamicStop} onChange={setDynamicStop} disabled={!stopLossEnabled} />
            </div>}
            {kind === "kol" && <div className="grid gap-3 md:grid-cols-2">
              <Toggle label="Freeze token after stop" detail="Block re-entry until cooldown expires." checked={freezeAfterStop} onChange={setFreezeAfterStop} disabled={!stopLossEnabled} />
              <Toggle label="Emergency exit" detail="If a sell keeps failing, widen slippage step by step up to 15% so the position can close." checked={emergencyExit} onChange={setEmergencyExit} />
            </div>}
            {autoReentry && kind === "discord" && <p className="text-[11px] leading-5 text-dim">A fresh call may open the token again after its previous position closes.</p>}
            {/* Directly below stop loss, per section 4. Not the same control as First call
                only: that one refuses a repeat call while a position is open, this one refuses
                a fresh entry once the position has closed. */}
            <Toggle
              label="Re-entry"
              detail="Allow a new position in a token this bot has already closed. Off finishes with the token."
              checked={autoReentry}
              onChange={setAutoReentry}
            />
          </FormSection>
          {/* Section 4: everything below is real, persisted, and mostly enforced — it is
              collapsed because a beginner should not have to answer sixty questions to place
              their first trade, not because any of it is decorative. */}
          <SectionGroup
            title={kind === "discord" ? "Advanced settings" : "Optional settings"}
            description={kind === "discord" ? "Exposure limits, exit details, safety filters, routing and retries." : "Entry triggers, staged buys, safety filters, routing and retries."}
            count={kind === "kol" ? "4 sections" : "4 sections"}
          >
          {kind === "discord" && (
            <FormSection title="Automation and exposure" description="Controls preserved for existing bots." summary={`${maximumCapitalSol.toFixed(2)} SOL cap · ${maxOpenTrades} open`}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Toggle label="Automatic entries" detail="Open new positions from this source's calls." checked={autoEntry} onChange={setAutoEntry} compact disabled={killSwitch} />
                <Toggle label="Automatic exits" detail="Run enabled exits without another signature." checked={autoExit} onChange={setAutoExit} compact disabled={killSwitch} />
                <Toggle label="Emergency stop" detail="Refuse new entries while open positions keep exiting." checked={killSwitch} onChange={setKillSwitch} compact danger />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <LimitField label="Maximum capital" on={limits.maximumCapital} onToggle={(on) => setLimit("maximumCapital", on)}><NumberField label="Maximum capital" hideLabel value={maximumCapitalSol} onChange={setMaximumCapitalSol} unit="SOL" step={0.5} min={0.1} disabled={!limits.maximumCapital} /></LimitField>
                <LimitField label="Maximum open trades" on={limits.maxOpenTrades} onToggle={(on) => setLimit("maxOpenTrades", on)}><NumberField label="Maximum open trades" hideLabel value={maxOpenTrades} onChange={(value) => setMaxOpenTrades(Math.round(value))} unit="trades" step={1} min={1} max={100} disabled={!limits.maxOpenTrades} /></LimitField>
                <LimitField label="Per-token exposure" on={limits.perTokenExposure} onToggle={(on) => setLimit("perTokenExposure", on)}><NumberField label="Per-token exposure" hideLabel value={perTokenSol} onChange={setPerTokenSol} unit="SOL" step={0.1} min={0.01} disabled={!limits.perTokenExposure} /></LimitField>
              </div>
            </FormSection>
          )}
          {kind === "discord" && (
            <FormSection title="Exit details" description="Optional staged profit-taking and stop behavior." summary="Advanced exit controls">
              <div className="grid gap-3 md:grid-cols-2">
                <Toggle label="Trailing take profit" detail="Trail enabled profit targets after activation." checked={trailingTakeProfit} onChange={setTrailingTakeProfit} disabled={!takeProfitEnabled} />
                <NumberField label="Stop debounce" value={stopDelaySeconds} onChange={(value) => setStopDelaySeconds(Math.round(value))} unit="sec" step={1} min={0} max={300} disabled={!stopLossEnabled} />
                <Toggle label="Trailing stop" detail="Move the stop upward with price." checked={trailingStop} onChange={setTrailingStop} disabled={!stopLossEnabled} />
                <Toggle label="Dynamic stop" detail="Use supported volatility evidence." checked={dynamicStop} onChange={setDynamicStop} disabled={!stopLossEnabled} />
                <Toggle label="Freeze after stop" detail="Block another entry until cooldown expires." checked={freezeAfterStop} onChange={setFreezeAfterStop} disabled={!stopLossEnabled} />
                <Toggle label="Emergency exit" detail="Widen bounded slippage if an exit keeps failing." checked={emergencyExit} onChange={setEmergencyExit} />
              </div>
            </FormSection>
          )}
          {kind === "kol" && (
            <FormSection
              title="Entry trigger"
            pending={pendingFor("entry")}
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
                    {PRESET_NAMES.map((value) => (
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
            pending={pendingFor("dca")}
              description="Optional staged entries after a deeper drop."
              summary={dcaEnabled ? `${dcaLevels.length} levels · ${dcaCapital.toFixed(2)} SOL` : "Off"}
            >
              <Toggle label="Enable DCA" detail="Add bounded buys after deeper price drops." checked={dcaEnabled} onChange={setDcaEnabled} />
              {dcaEnabled && (
                <>
                  <div className="divide-y divide-edge rounded-md border border-edge">
                    {dcaLevels.map((level, index) => (
                      <div key={index} className="grid gap-3 p-3 sm:grid-cols-[92px_repeat(2,minmax(0,1fr))_36px] sm:items-end">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={level.enabled}
                          aria-label={`Dollar-cost averaging level ${index + 1}`}
                          onClick={() => updateDca(index, { enabled: !level.enabled })}
                          className="flex min-h-11 items-center gap-2 text-left sm:min-h-0 sm:self-center"
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${level.enabled ? "bg-up" : "bg-edge"}`} />
                          <span className="font-mono text-xs text-dim">DCA {index + 1}</span>
                          <span className={`font-mono text-[9px] uppercase ${level.enabled ? "text-up" : "text-dim"}`}>
                            {level.enabled ? "On" : "Off"}
                          </span>
                        </button>
                        <label><span className="field-label">Additional drop</span><span className="mt-1.5 block"><CompactNumber ariaLabel={`DCA ${index + 1} additional drop`} value={level.dropBps / 100} onChange={(value) => updateDca(index, { dropBps: Math.round(value * 100) })} suffix="%" disabled={!level.enabled} /></span></label>
                        <label><span className="field-label">Buy amount</span><span className="mt-1.5 block"><CompactNumber ariaLabel={`DCA ${index + 1} buy amount`} value={level.buyAmountSol} onChange={(value) => updateDca(index, { buyAmountSol: value })} suffix="SOL" disabled={!level.enabled} /></span></label>
                        <button type="button" onClick={() => setDcaLevels((current) => current.filter((_, itemIndex) => itemIndex !== index))} disabled={dcaLevels.length === 1} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md text-dim hover:bg-down/10 hover:text-down disabled:opacity-30" aria-label={`Remove DCA level ${index + 1}`}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" onClick={() => setDcaLevels((current) => current.length < 6 ? [...current, { dropBps: 3000, buyAmountSol: 0.25, enabled: true }] : current)} disabled={dcaLevels.length >= 6} className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-edge px-3 text-xs font-semibold text-ink disabled:opacity-40"><Plus size={14} /> Add DCA level</button>
                    <NumberField label="DCA expiration" value={dcaExpirationMinutes} onChange={(value) => setDcaExpirationMinutes(Math.round(value))} unit="min" step={30} min={30} max={10080} compact />
                  </div>
                </>
              )}
            </FormSection>
          )}
          <FormSection
            title="Security filters"
            pending={pendingFor("safety")}
            description="Only open this when you need to change the recommended safeguards."
            summary={`${enabledSafetyCount} checks enabled`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-edge bg-void px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-ink">Recommended protection is on</p>
                <p className="mt-1 text-[11px] leading-5 text-dim">Enabled checks fail closed when fresh evidence is unavailable.</p>
              </div>
              <button
                type="button"
                onClick={() => setSecurityOpen(true)}
                className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-gold-400/50 px-4 text-xs font-semibold text-gold-400"
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
              <button type="button" onClick={runPreview} disabled={previewing} className="inline-flex min-h-11 sm:min-h-10 items-center gap-2 rounded-md border border-gold-400/50 px-4 text-xs font-semibold text-gold-400 disabled:opacity-50">
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
            {previewError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-down/35 bg-down/5 px-4 py-3 text-xs text-down">
                <span>{previewError}</span>
                <button type="button" onClick={runPreview} className="min-h-9 rounded-md border border-down/35 px-3 font-semibold text-ink">Try again</button>
              </div>
            )}
          </FormSection>
          <FormSection
            title="Execution and retries"
            pending={pendingFor("execution")}
            description="Fine-tune route, fees, retry bounds, and cooldown."
            summary={`${entryMode} · ${(slippageBps / 100).toFixed(2)}% slippage · ${autoRetryCount} retries`}
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField label="Entry mode" value={entryMode} onChange={(value) => setEntryMode(value as typeof entryMode)} options={[{ value: "market", label: "Market route" }, { value: "limit", label: "Limit entry" }]} />
              <NumberField label="Slippage cap" value={slippageBps / 100} onChange={(value) => setSlippageBps(Math.round(value * 100))} unit="%" step={0.25} min={0.01} max={20} />
              <SelectField label="Priority fee" value={priorityStrategy} onChange={(value) => setPriorityStrategy(value as typeof priorityStrategy)} options={[{ value: "economy", label: "Economy" }, { value: "auto", label: "Automatic" }, { value: "fast", label: "Fast" }]} />
              <LimitField label="Priority fee maximum" on={limits.priorityFee} onToggle={(on) => setLimit("priorityFee", on)}>
                <NumberField label="Priority fee maximum" hideLabel value={priorityFeeMax} onChange={(value) => setPriorityFeeMax(Math.round(value))} unit="lamports" step={100000} min={0} max={100000000} disabled={!limits.priorityFee} />
              </LimitField>
              <NumberField label="Auto retries" value={autoRetryCount} onChange={(value) => setAutoRetryCount(Math.round(value))} unit="tries" step={1} min={0} max={10} />
              <NumberField label="Limit retries" value={limitRetryCount} onChange={(value) => setLimitRetryCount(Math.round(value))} unit="tries" step={1} min={0} max={10} />
              <NumberField label="Quote expiration" value={quoteExpirationSeconds} onChange={(value) => setQuoteExpirationSeconds(Math.round(value))} unit="sec" step={5} min={5} max={300} />
              <LimitField label="Token cooldown" on={limits.cooldown} onToggle={(on) => setLimit("cooldown", on)}>
                <NumberField label="Token cooldown" hideLabel value={cooldownSeconds / 60} onChange={(value) => setCooldownSeconds(Math.round(value * 60))} unit="min" step={5} min={0} max={10080} disabled={!limits.cooldown} />
              </LimitField>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle label="Transaction simulation" detail="Reject the order when simulation is unavailable or fails." checked={simulationRequired} onChange={setSimulationRequired} />
              {kind === "discord" && <Toggle label="First call only" detail="Ignore repeat calls for the token during the cooldown." checked={firstCallOnly} onChange={setFirstCallOnly} />}
            </div>
          </FormSection>
          </SectionGroup>
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
            <SummaryRow label={kind === "discord" ? "Margin per trade" : "Buy amount"} value={`${buyAmountSol.toFixed(3)} SOL`} />
            {kind === "discord" && <SummaryRow label="Max funds per day" value={`${dailyLossSol.toFixed(3)} SOL`} />}
            <SummaryRow label="Maximum capital" value={`${maximumCapitalSol.toFixed(3)} SOL`} />
            <SummaryRow label="Open trades" value={String(maxOpenTrades)} />
            <SummaryRow label="Take profit" value={takeProfitEnabled ? `+${((tpLevels[0]?.targetBps || 0) / 100).toFixed(2)}%` : "Off"} />
            <SummaryRow label="Stop loss" value={stopLossEnabled ? `-${(stopBps / 100).toFixed(2)}%` : "Off"} />
            {kind === "discord" && <SummaryRow label="Re-entry" value={autoReentry ? "On" : "Off"} />}
            <SummaryRow label="Slippage" value={`${(slippageBps / 100).toFixed(2)}%`} />
            <SummaryRow
              label="Maximum exposure"
              value={`${lamportsToSol(
                limits.maximumCapital && capitalPlan.perPositionLamports * BigInt(capitalPlan.positions) > BigInt(Math.round(maximumCapitalSol * 1e9))
                  ? BigInt(Math.round(maximumCapitalSol * 1e9))
                  : capitalPlan.plannedLamports
              )} SOL`}
              hint="The most this bot can have deployed at once: entry plus enabled DCA, times maximum open trades, capped by maximum capital. This omitted DCA before, so it could read lower than the minimum capital shown above it."
            />
            {/* One user-facing rate. Listing the creator share as a second row read as
                2.00% + 0.70% additive, which is exactly what spec 13.2 forbids -- the
                creator is paid OUT OF the platform fee, not on top of it. */}
            <SummaryRow
              label="Platform fee"
              value={formatPercentBps(platformFeeBps)}
              hint={`Charged on each confirmed swap leg. The ${formatPercentBps(creatorFeeBps)} creator share is paid out of this fee, not added to it.`}
            />
            <SummaryRow
              label="Fee per entry"
              value={formatSol(platformFeeLamports)}
              hint={`Estimated on a ${buyAmountSol.toFixed(3)} SOL entry. Solana network and priority fees are separate.`}
            />
          </dl>
          {/* Two actions, exactly as section 5 specifies. RUN asks the server; the reason it
              shows is whichever single check failed first, so it is different for a user with
              no wallet and a user waiting on the fee account. Nothing here is computed from a
              frozen constant any more. */}
          <div className="border-t border-edge p-5">
            <p className="flex items-center justify-between gap-3">
              <span className="field-label">State</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-gold-400">{stateLabel}</span>
            </p>
            {(validationError || readiness) && (
              <div
                role={validationError || readiness?.ready === false ? "alert" : "status"}
                className={`mt-3 rounded-md border px-3 py-2.5 text-[11px] leading-5 ${
                  validationError || readiness?.ready === false
                    ? "border-down/35 bg-down/5 text-down"
                    : "border-up/30 bg-up/5 text-up"
                }`}
              >
                {validationError || (readiness?.ready ? "Every readiness check passes." : readiness?.reason)}
              </div>
            )}
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={run}
                disabled={saving || checking}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-gold-400 px-4 text-sm font-semibold text-[#17110c] disabled:opacity-50"
              >
                {checking ? <Loader2 aria-hidden="true" size={15} className="animate-spin" /> : <ShieldCheck aria-hidden="true" size={15} />}
                {checking ? "Checking" : "RUN"}
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
                Save and use later
              </button>
            </div>
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
                <p className="mt-1 text-[11px] leading-5 text-dim">The final review shows enabled and disabled counts. Enabled checks reject missing or stale evidence.</p>
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
                              <td className="px-3 py-3"><CompactNumber ariaLabel={`${definition.label} minimum`} value={value.min} onChange={(next) => setFilters((current) => ({ ...current, [definition.key]: { ...value, min: next } }))} suffix={definition.unit} disabled={!value.enabled} /></td>
                              <td className="px-3 py-3"><CompactNumber ariaLabel={`${definition.label} maximum`} value={value.max} onChange={(next) => setFilters((current) => ({ ...current, [definition.key]: { ...value, max: next } }))} suffix={definition.unit} disabled={!value.enabled} /></td>
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
              <p className="font-mono text-[9px] text-dim">{enabledSafetyCount} total checks enabled</p>
              <button type="button" onClick={() => setSecurityOpen(false)} className="min-h-11 sm:min-h-10 rounded-md bg-gold-400 px-5 text-sm font-semibold text-[#17110c]">Done</button>
            </footer>
          </div>
        </div>
      )}

      {confirmStatus && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4" onClick={() => { setConfirmStatus(null); setConfirmReviewed(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-bot-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-md border border-edge bg-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-edge p-5">
              <div><p className="font-mono text-[9px] uppercase text-gold-400">Final confirmation</p><h2 id="confirm-bot-title" className="mt-2 text-lg font-semibold text-ink">{confirmStatus === "active" ? "Activate this bot?" : "Save this draft?"}</h2></div>
              <button type="button" onClick={() => { setConfirmStatus(null); setConfirmReviewed(false); }} className="grid h-11 w-11 place-items-center sm:h-9 sm:w-9 rounded-md border border-edge text-dim" aria-label="Close confirmation"><X size={16} /></button>
            </header>
            <div className="space-y-4 p-5">
              {[
                {
                  title: "Main settings",
                  items: [
                    ["Bot", `${name} · ${kind === "discord" ? "Discord Bot" : "KOL Bot"}`],
                    ["Source", kind === "discord" ? `${source?.name || "Not selected"} · ${channelId ? source?.channels.find((channel) => channel.id === channelId)?.name || channelId : "All approved channels"}` : `${preset} scanner preset`],
                    ["Wallet", walletAddress || "Not connected"],
                    ...(kind === "kol" ? [["Visibility", visibility === "public" ? "Public after review" : "Private draft"]] : [])
                  ]
                },
                {
                  title: "Buy settings",
                  items: [
                    ["Entry", `${buyAmountSol} SOL · ${entryMode} · ${maxOpenTrades} maximum trades`],
                    ["Capital", `${maximumCapitalSol} SOL maximum · ${dailyLossSol} SOL max funds per day · ${perTokenSol} SOL per token`],
                    ...(kind === "kol" ? [
                      ["Trigger", `-${priceDropBps / 100}% from ${referenceMode === "recent-ath" ? "recent ATH" : "moving average"} over ${lookbackMinutes} minutes`],
                      ["DCA", dcaEnabled ? `${dcaLevels.length} levels · ${dcaCapital.toFixed(3)} SOL per trade` : "Off"]
                    ] : [])
                  ]
                },
                {
                  title: "Sell settings",
                  items: [
                    ["Take profit", takeProfitEnabled ? tpLevels.filter((level) => level.enabled).map((level) => `+${level.targetBps / 100}% / sell ${level.sellBps / 100}%${trailingTakeProfit ? ` / trail ${level.trailingBps / 100}%` : ""}`).join(" · ") : "Off"],
                    ["Stop loss", stopLossEnabled ? `-${stopBps / 100}%${trailingStop ? " · trailing" : ""}${dynamicStop ? " · dynamic" : ""}${freezeAfterStop ? " · freeze after stop" : ""}` : "Off"],
                    ...(kind === "discord" ? [["Re-entry", autoReentry ? "On" : "Off"]] : [])
                  ]
                },
                {
                  title: "Advanced settings",
                  items: [
                    ["Execution", `${slippageBps / 100}% slippage · ${priorityStrategy} priority up to ${priorityFeeMax.toLocaleString()} lamports`],
                    ["Retries and cooldown", `${autoRetryCount} auto · ${limitRetryCount} limit · ${quoteExpirationSeconds}s quote · ${Math.round(cooldownSeconds / 60)}m cooldown${firstCallOnly ? " · first call only" : ""}`],
                    ["Security", `${enabledSafetyCount} enabled · ${totalSafetyCount - enabledSafetyCount} off · missing data fails closed`],
                    ["Fees and exposure", `${formatPercentBps(platformFeeBps)} platform fee · creator receives ${formatPercentBps(creatorFeeBps)} from that fee · ${maximumCapitalSol.toFixed(3)} SOL capital ceiling`]
                  ]
                }
              ].map((group) => (
                <section key={group.title}>
                  <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[0.1em] text-gold-400">{group.title}</h3>
                  <div className="grid gap-px overflow-hidden rounded-md border border-edge bg-edge sm:grid-cols-2">
                    {group.items.map(([label, value]) => (
                      <div key={label} className="bg-void p-3"><p className="field-label">{label}</p><p className="mt-1.5 break-words text-xs leading-5 text-ink">{value}</p></div>
                    ))}
                  </div>
                </section>
              ))}
              <div className="mt-4 flex gap-3 rounded-md border border-gold-400/35 bg-gold-400/5 p-3 text-xs leading-5 text-dim">
                <AlertTriangle className="mt-0.5 shrink-0 text-gold-400" size={16} />
                <p>Only signals that pass every selected filter are eligible. Saving this draft cannot move funds, and bots do not place trades on their own until the execution worker is running.</p>
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
  pending = null,
  children
}: {
  title: string;
  description: string;
  summary?: string;
  defaultOpen?: boolean;
  /** Controls in this section that persist and version but do not yet change execution. */
  pending?: { labels: string[]; reasons: string[] } | null;
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
      <div className="space-y-4 border-t border-edge p-5">
        {pending && (
          <div className="rounded-md border border-edge bg-void px-3.5 py-3" title={pending.reasons.join("\n\n")}>
            <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-gold-400">Saved, not acting on trades yet</p>
            <p className="mt-1.5 text-[11px] leading-5 text-dim">{pending.labels.join(" · ")}</p>
          </div>
        )}
        {children}
      </div>
    </details>
  );
}

/**
 * The `Optional settings` divider from section 4 of the release directive.
 *
 * The problem it solves is not that the advanced controls are wrong — every one of them is
 * real, persisted and, for 37 of them, enforced. It is that presenting sixty controls flat
 * makes the five that decide whether a bot makes money indistinguishable from the fifty-five
 * that tune it. A beginner reads all of them or none.
 *
 * Collapsed by default and NEVER auto-expanded on validation error: an error inside a closed
 * group is surfaced by the summary line and the sticky panel, and popping the group open would
 * undo the simplification exactly when the user is already confused. The summary counts what is
 * inside so a closed group is not an empty promise.
 */
function SectionGroup({ title, description, count, children }: {
  title: string;
  description: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group bg-void">
      <summary className="flex min-h-[68px] list-none items-center justify-between gap-4 px-5 py-3.5">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">{title}</span>
          <span className="mt-1 block text-[11px] leading-4 text-dim">{description}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span className="hidden font-mono text-[9px] text-dim sm:block">{count}</span>
          <span className="grid h-8 w-8 place-items-center rounded-md border border-edge text-dim transition group-open:border-gold-400/40 group-open:text-gold-400">
            <ChevronDown aria-hidden="true" size={15} className="transition group-open:rotate-180" />
          </span>
        </span>
      </summary>
      <div className="space-y-px border-t border-edge bg-edge">{children}</div>
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

function SelectField({ label, value, onChange, options, userContent = false }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>;
  /**
   * The option labels are third-party strings — Discord server and channel names — not copy we
   * wrote. `data-user-content` marks them so the browser audit's emoji rule skips them.
   *
   * The rule forbids emoji as an INTERFACE ICON. A Discord channel genuinely named
   * "🍆︴sol-alpha" is the channel's name, and stripping it would show the user a channel that
   * does not exist. Faithfully displaying someone else's name is not us picking an icon.
   */
  userContent?: boolean }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field-control mt-1.5 px-3"
        {...(userContent ? { "data-user-content": "true" } : {})}
      >
        {options.length === 0 && <option value="">No options available</option>}
        {options.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

/**
 * A numeric limit with its own ON/OFF switch.
 *
 * The switch is not cosmetic and it is not the same as clearing the field. Every one of these
 * limits keeps its number at all times — `subscriber_config_valid` requires several of them to
 * be present and numeric — so "off" is expressed by the flag in `config.limits`, which
 * worker_claim_call_execution reads before it applies the corresponding cap.
 *
 * The state is in the text, not only in the colour: FINAL_LAUNCH_SPEC requires every switch to
 * SAY On or Off, and a green dot alone is unreadable to anyone who cannot distinguish it.
 */
function LimitField({
  label,
  on,
  onToggle,
  children
}: {
  label: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="field-label">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          // Not `${label} limit`: several of these labels already end in "limit", which produced
          // "Daily loss limit limit" for a screen reader.
          aria-label={`${label}: ${on ? "on" : "off"}`}
          onClick={() => onToggle(!on)}
          // 44px in BOTH dimensions. Shipped at 25x44 — tall enough, a third of the minimum
          // wide — which is the exact shape the audit's min(width, height) rule exists to catch,
          // and it caught it on production rather than in review.
          className="flex min-h-11 min-w-11 items-center justify-end gap-1.5"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-up" : "bg-edge"}`} />
          <span className={`font-mono text-[9px] uppercase ${on ? "text-up" : "text-dim"}`}>{on ? "On" : "Off"}</span>
        </button>
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
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
  compact = false,
  disabled = false,
  hideLabel = false
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit: string;
  step: number;
  min: number;
  max?: number;
  compact?: boolean;
  /**
   * The label is drawn by an enclosing LimitField, beside its switch. Hidden VISUALLY only —
   * the input keeps its accessible name through NumericTextInput's ariaLabel, so a screen
   * reader still hears "Maximum capital" rather than an unnamed spin button.
   */
  hideLabel?: boolean;
  /**
   * Semantically disabled, not just faded. A module switched off must leave its fields
   * unreachable by keyboard too — a greyed field that still accepts Tab and edits is a
   * control that looks inert and is not.
   */
  disabled?: boolean;
}) {
  // A whole-number step means a whole-number field, so the decimal point is rejected at
  // keystroke time rather than accepted and then silently truncated.
  const decimals = Number.isInteger(step) ? 0 : 4;
  const update = (next: number) => onChange(Math.min(max, Math.max(min, Number(next.toFixed(6)))));
  return (
    <label className={`${compact ? "block min-w-64" : "block"}${disabled ? " opacity-45" : ""}`}>
      {!hideLabel && <span className="field-label">{label}</span>}
      <span className="field-control mt-1.5 flex overflow-hidden">
        <button type="button" disabled={disabled} onClick={() => update(value - step)} className="grid h-11 w-10 shrink-0 place-items-center border-r border-edge text-dim hover:text-ink disabled:pointer-events-none" aria-label={`Decrease ${label}`}><Minus size={13} /></button>
        <NumericTextInput
          value={value}
          onChange={onChange}
          disabled={disabled}
          min={min}
          max={max}
          decimals={decimals}
          ariaLabel={label}
          className="min-w-0 flex-1 bg-transparent px-2 text-center font-mono text-xs text-ink outline-none"
        />
        <span className="self-center pr-2 font-mono text-[9px] text-dim">{unit}</span>
        <button type="button" disabled={disabled} onClick={() => update(value + step)} className="grid h-11 w-10 shrink-0 place-items-center border-l border-edge text-dim hover:text-ink disabled:pointer-events-none" aria-label={`Increase ${label}`}><Plus size={13} /></button>
      </span>
    </label>
  );
}

function CompactNumber({ ariaLabel, value, onChange, suffix, disabled = false }: { ariaLabel: string; value: number; onChange: (value: number) => void; suffix: string; disabled?: boolean }) {
  return (
    <span className={`flex min-h-11 sm:min-h-9 min-w-36 items-center rounded-md border border-edge bg-void px-2 ${disabled ? "opacity-45" : "focus-within:border-gold-400"}`}>
      <NumericTextInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        min={0}
        decimals={4}
        ariaLabel={ariaLabel}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none"
      />
      <span className="ml-2 font-mono text-[8px] text-dim">{suffix}</span>
    </span>
  );
}

/**
 * A switch that SAYS whether it is on.
 *
 * This previously conveyed its state through the pill's colour alone — green for on, edge grey
 * for off. That is unreadable to anyone with a colour vision deficiency, it disappears in a
 * screenshot printed in greyscale, and on a control that decides whether a stop loss exists it
 * is the difference between a bounded position and an unbounded one. WCAG 1.4.1 forbids colour
 * as the only carrier of meaning, and this is the clearest case of it in the product.
 *
 * `role="switch"` with `aria-checked` already gave the state to a screen reader and keyboard
 * activation already worked, because it is a real button. What was missing was the state being
 * visible to someone looking at it.
 */
function Toggle({ label, detail, checked, onChange, danger = false, compact = false, disabled = false }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void; danger?: boolean; compact?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-4 rounded-md border border-edge bg-void px-3 py-2.5 text-left transition focus-visible:border-gold-400 disabled:opacity-40 ${compact ? "min-w-72" : "w-full"}`}
    >
      <span className="min-w-0">
        <span className={`block text-xs font-medium ${danger && checked ? "text-gold-400" : "text-ink"}`}>{label}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-dim">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`font-mono text-[9px] uppercase tracking-[0.08em] ${checked ? danger ? "text-gold-400" : "text-up" : "text-dim"}`}>
          {checked ? "On" : "Off"}
        </span>
        <span className={`relative h-6 w-11 rounded-full transition ${checked ? danger ? "bg-gold-400" : "bg-up" : "bg-edge"}`}>
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-void transition ${checked ? "left-6" : "left-1"}`} />
        </span>
      </span>
    </button>
  );
}

function SummaryRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="flex items-center gap-1.5 text-[11px] text-dim">
        {label}
        {/* Progressive disclosure: detail lives behind an info affordance rather than
            as helper text under every row (spec 6.1, 6.3). */}
        {hint && <span title={hint} aria-label={hint} role="img" className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-dim/50 font-mono text-[8px] leading-none text-dim">i</span>}
      </dt>
      <dd className="max-w-[58%] text-right font-mono text-[10px] leading-4 text-ink">{value}</dd>
    </div>
  );
}

function SourceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-void px-4 py-3">
      <p className="field-label">{label}</p>
      <p className="mt-2 font-mono text-xs leading-5 text-ink">{value}</p>
    </div>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-2 rounded-md border border-down/35 bg-down/5 px-3 py-2 text-xs text-down"><AlertTriangle size={14} />{children}</p>;
}
