"use client";

export type BotKind = "discord" | "kol";
export type BotStatus = "draft" | "active" | "paused" | "stopping" | "archived" | "error";

export type ProductBot = {
  id: string;
  kind: BotKind;
  name: string;
  description: string;
  status: BotStatus;
  visibility: "private" | "public";
  executionMode: "solana-mainnet";
  sourceGroupId?: string | null;
  sourceName?: string | null;
  version: number;
  config: Record<string, any>;
  strategyId?: string | null;
  strategySlug?: string | null;
  moderationStatus?: string | null;
  creatorFeeBps?: number | null;
  enabled?: boolean;
  sampleSize?: number;
  netPnlLamports?: number | string | null;
  volumeLamports?: number | string | null;
  networkFeesLamports?: number | string | null;
  platformFeesLamports?: number | string | null;
  creatorFeesLamports?: number | string | null;
  openTrades?: number;
  followers?: number;
  created_at?: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BotActivitySignal = {
  id: string;
  status: string;
  parseStatus: string;
  mint: string | null;
  confidenceBps: number | null;
  reason: string | null;
  sourceType: string;
  sourceRef: string;
  receivedAt: string;
  createdAt: string;
  finishedAt: string | null;
};

export type BotActivityExecution = {
  id: string;
  intentKind: string;
  side: string;
  mint: string;
  state: string;
  executionMode: string;
  requestedInputBaseUnits: string;
  executionStatus: string | null;
  attempt: number | null;
  txSignature: string | null;
  grossNotionalLamports: string | null;
  networkFeeLamports: string | null;
  priorityFeeLamports: string | null;
  platformFeeLamports: string | null;
  creatorFeeLamports: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  reconciledAt: string | null;
};

export type DiscordSource = {
  id: string;
  name: string;
  members: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  description: string;
  ownerDisplayName: string | null;
  joinUrl: string | null;
  publicSlug: string | null;
  referralCode: string | null;
  creatorFeeBps: number;
  verificationStatus: string;
  marketplaceVisible: boolean;
  integrationHealth: "pending" | "healthy" | "degraded" | "unavailable";
  eligibleCalls: number;
  acceptedCalls?: number;
  rejectedCalls?: number;
  executedCalls?: number;
  measuredCalls: number;
  // Peak-multiple ladder, lowest first. Exclusive: a measured call is in exactly one.
  // `down50` — peak never reached 0.5x, so entry was never half recovered.
  down50?: number;
  under50: number;
  plus50: number;
  twoX: number;
  fiveX: number;
  averageReturnX: number | null;
  medianReturnX: number | null;
  // Two distinct figures. `winRate` is the share that traded above entry at any point;
  // `twoXRate` is the share that doubled. They were one field named after the first and
  // computed as the second, so the marketplace list understated every source.
  winRate: number | null;
  twoXRate?: number | null;
  bestCall?: DiscordSourceCall | null;
  worstCall?: DiscordSourceCall | null;
  copiedExecutions?: number;
  /** Integer lamports as a string; confirmed executed notional attributed to this source. */
  copiedVolumeLamports?: string | null;
  maxDrawdownBps: number | null;
  performance1d?: DiscordSourcePerformance | null;
  performance7d?: DiscordSourcePerformance | null;
  performance30d?: DiscordSourcePerformance | null;
  activeFollowers: number;
  channels: Array<{ id: string; name: string | null }>;
  dataFreshnessAt: string | null;
  lastSignalAt: string | null;
  lastProcessedCallAt?: string | null;
  lastSuccessfulExecutionAt?: string | null;
  profileSyncedAt: string | null;
  lastVerifiedAt: string | null;
  approvedAt: string | null;
};

export type DiscordSourcePerformance = {
  sampleSize: number;
  netPnlLamports: number | string | null;
  asOf: string;
};

export type DiscordSourceCall = {
  mint: string | null;
  symbol: string | null;
  peakX: number | string | null;
  calledAt: string | null;
};

export type KolStrategy = {
  id: string;
  slug: string;
  name: string;
  description: string;
  creatorName: string;
  status: string;
  executionMode: string;
  version: number;
  schemaVersion: number;
  config: Record<string, any>;
  creatorFeeBps: number;
  riskTier: string;
  sampleSize: number;
  netPnlLamports: number | string | null;
  realizedPnlLamports: number | string | null;
  volumeLamports: number | string | null;
  networkFeesLamports: number | string | null;
  platformFeesLamports: number | string | null;
  creatorFeesLamports: number | string | null;
  maxDrawdownBps: number | null;
  winRateBps: number | null;
  metrics: Record<string, any> | null;
  followers: number;
  openTrades: number;
  activeSince: string | null;
  createdAt: string;
  updatedAt: string;
  insufficientHistory: boolean;
};

type AuthOptions = {
  getAccessToken: () => Promise<string | null>;
  identityToken?: string | null;
};

async function parseResponse<T>(response: Response | null): Promise<T> {
  if (!response) throw new Error("Network request failed");
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data as T;
}

export async function productFetch<T>(url: string, auth?: AuthOptions, init?: RequestInit): Promise<T> {
  const accessToken = auth ? await auth.getAccessToken() : null;
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(auth?.identityToken ? { "privy-id-token": auth.identityToken } : {}),
      ...(init?.headers || {})
    }
  }).catch(() => null);
  return parseResponse<T>(response);
}

export function lamportsToSol(value: number | string | bigint | null | undefined) {
  if (value == null) return 0;
  try {
    return Number(BigInt(value)) / 1_000_000_000;
  } catch {
    return Number(value) / 1_000_000_000 || 0;
  }
}

export function formatSol(value: number | string | bigint | null | undefined, digits = 3) {
  return `${lamportsToSol(value).toLocaleString(undefined, { maximumFractionDigits: digits })} SOL`;
}

export function solToLamports(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return String(Math.round(value * 1_000_000_000));
}

export function formatPercentBps(value: number | null | undefined) {
  return value == null ? "--" : `${(value / 100).toFixed(2)}%`;
}

export function formatWhen(value: string | null | undefined) {
  if (!value) return "No data yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No data yet";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
