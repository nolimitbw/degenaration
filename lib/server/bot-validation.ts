import { BASE58_RE, UUID_RE, boundedInteger, exactLamports, isObject } from "@/lib/server/product";
import { isDiscordSnowflake } from "@/lib/server/bot-auth";

const BOT_STATUSES = new Set(["draft", "active", "paused", "stopping", "archived", "error"]);
const VISIBILITIES = new Set(["private", "public"]);
const MODES = new Set(["solana-mainnet"]);

function levelsValid(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) return false;
  let allocation = 0;
  let previousTarget = 0;
  for (const level of value) {
    if (!isObject(level)) return false;
    const target = boundedInteger(level.targetBps, 1, 100_000);
    const sell = boundedInteger(level.sellBps, 1, 10_000);
    if (target == null || sell == null || target <= previousTarget) return false;
    previousTarget = target;
    allocation += sell;
  }
  return allocation <= 10_000;
}

function dcaCapitalLamports(value: unknown) {
  if (!isObject(value) || value.enabled !== true) return BigInt(0);
  if (!Array.isArray(value.levels) || value.levels.length < 1 || value.levels.length > 6) return null;
  let total = BigInt(0);
  let previousDrop = 0;
  for (const level of value.levels) {
    if (!isObject(level)) return null;
    const drop = boundedInteger(level.dropBps, 1, 10_000);
    const buyAmountSol = Number(level.buyAmountSol);
    if (
      drop == null ||
      drop <= previousDrop ||
      !Number.isFinite(buyAmountSol) ||
      buyAmountSol <= 0 ||
      buyAmountSol > 100
    ) {
      return null;
    }
    previousDrop = drop;
    total += BigInt(Math.round(buyAmountSol * 1e9));
  }
  if (boundedInteger(value.expirationMinutes, 30, 10_080) == null) return null;
  return total;
}

export function validateBotPayload(raw: unknown) {
  if (!isObject(raw) || !isObject(raw.config)) return { error: "invalid bot payload" } as const;
  const kind = raw.kind === "discord" || raw.kind === "kol" ? raw.kind : null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const status = typeof raw.status === "string" && BOT_STATUSES.has(raw.status) ? raw.status : null;
  const visibility = typeof raw.visibility === "string" && VISIBILITIES.has(raw.visibility) ? raw.visibility : null;
  const executionMode = typeof raw.executionMode === "string" && MODES.has(raw.executionMode) ? raw.executionMode : null;
  if (raw.executionMode !== "solana-mainnet") {
    return { error: "Solana mainnet is the only supported execution mode" } as const;
  }
  if (!kind || !status || !visibility || !executionMode || !name || name.length > 80 || description.length > 600) {
    return { error: "invalid bot identity" } as const;
  }
  if (raw.id != null && (typeof raw.id !== "string" || !UUID_RE.test(raw.id))) {
    return { error: "invalid bot id" } as const;
  }
  if (kind === "discord" && (typeof raw.sourceGroupId !== "string" || !UUID_RE.test(raw.sourceGroupId))) {
    return { error: "approved Discord source required" } as const;
  }
  if (status === "active" && raw.confirmed !== true) {
    return { error: "activation confirmation required" } as const;
  }

  const config = raw.config;
  const walletAddress = typeof config.walletAddress === "string" ? config.walletAddress.trim() : "";
  const walletId = typeof config.walletId === "string" ? config.walletId.trim() : "";
  if (walletAddress && !BASE58_RE.test(walletAddress)) return { error: "invalid wallet address" } as const;
  if (Boolean(walletAddress) !== Boolean(walletId) || walletId.length > 200) {
    return { error: "wallet ownership proof required" } as const;
  }
  if (status === "active" && !walletAddress) {
    return { error: "verified execution wallet required" } as const;
  }
  if (status === "active" && config.simulationRequired !== true) {
    return { error: "transaction simulation is required for activation" } as const;
  }
  if (config.channelId != null && config.channelId !== "" && !isDiscordSnowflake(config.channelId)) {
    return { error: "invalid Discord channel" } as const;
  }

  const lamports: Record<string, string> = {};
  for (const field of ["buyAmountLamports", "maximumCapitalLamports", "dailyLossLimitLamports", "perTokenExposureLamports"]) {
    const amount = exactLamports(config[field]);
    if (amount == null) return { error: `invalid ${field}` } as const;
    lamports[field] = amount;
  }
  const buyAmount = BigInt(lamports.buyAmountLamports);
  const maximumCapital = BigInt(lamports.maximumCapitalLamports);
  const dailyLossLimit = BigInt(lamports.dailyLossLimitLamports);
  const perTokenExposure = BigInt(lamports.perTokenExposureLamports);
  if (
    buyAmount > perTokenExposure ||
    perTokenExposure > maximumCapital ||
    dailyLossLimit > maximumCapital
  ) {
    return { error: "capital limits are inconsistent" } as const;
  }

  let maxOpenTrades: number | null = null;
  for (const [field, min, max] of [
    ["maxOpenTrades", 1, 100],
    ["slippageBps", 1, 2_000],
    ["priorityFeeMaxLamports", 0, 100_000_000],
    ["autoRetryCount", 0, 10],
    ["limitRetryCount", 0, 10],
    ["quoteExpirationSeconds", 5, 300],
    ["cooldownSeconds", 0, 604_800]
  ] as const) {
    const value = boundedInteger(config[field], min, max);
    if (value == null) {
      return { error: `invalid ${field}` } as const;
    }
    if (field === "maxOpenTrades") maxOpenTrades = value;
  }
  if (!isObject(config.takeProfit) || !levelsValid(config.takeProfit.levels)) {
    return { error: "invalid take-profit allocation" } as const;
  }
  if (!isObject(config.stopLoss) || boundedInteger(config.stopLoss.stopBps, 1, 10_000) == null) {
    return { error: "invalid stop loss" } as const;
  }
  const dcaCapital = kind === "kol" ? dcaCapitalLamports(config.dca) : BigInt(0);
  if (dcaCapital == null) return { error: "invalid DCA levels" } as const;
  if ((buyAmount + dcaCapital) * BigInt(maxOpenTrades!) > maximumCapital) {
    return { error: "maximum capital does not cover configured entries" } as const;
  }
  if (kind === "kol") {
    if (!isObject(config.trigger) || boundedInteger(config.trigger.priceDropBps, 1, 10_000) == null) {
      return { error: "invalid KOL trigger" } as const;
    }
    if (boundedInteger(config.trigger.lookbackMinutes, 1, 10_080) == null) {
      return { error: "invalid KOL lookback" } as const;
    }
  }
  if (config.manualMints != null) {
    if (
      !Array.isArray(config.manualMints) ||
      config.manualMints.length > 50 ||
      config.manualMints.some((mint: unknown) => typeof mint !== "string" || !BASE58_RE.test(mint))
    ) {
      return { error: "invalid manual token list" } as const;
    }
  }

  return {
    value: {
      ...raw,
      name,
      description,
      kind,
      status,
      visibility,
      executionMode,
      schemaVersion: 1,
      config: {
        ...config,
        ...lamports,
        walletAddress: walletAddress || null,
        walletId: walletId || null
      }
    },
    walletAddress,
    walletId
  } as const;
}
