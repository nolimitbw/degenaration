export type AdminTab =
  | "overview"
  | "discord"
  | "kol"
  | "referrals"
  | "clients"
  | "revenue"
  | "payouts"
  | "operations"
  | "users"
  | "system"
  | "audit";

export type Application = {
  id: string;
  server_name: string;
  invite_link: string;
  owner_handle: string;
  member_count: string | null;
  pitch: string | null;
  status: string;
  created_at: string;
};

export type Channel = {
  id: string;
  guild_id?: string;
  guild_name: string | null;
  channel_name: string | null;
  channel_id: string;
  registered_by: string | null;
  guild_member_count: number | null;
  status: string;
  group_id: string | null;
  decision_reason?: string | null;
  integration_health?: string | null;
  profile_synced_at?: string | null;
  profile_sync_error?: string | null;
  created_at: string;
};

export type ReferralFlag = {
  id: string;
  type: string;
  severity: string;
  status: string;
  reason: string;
  createdAt: string;
};

export type ReferralAttribution = {
  id: string;
  referrerPrivyUserId: string;
  referredPrivyUserId: string;
  status: string;
  statusReason: string;
  firstQualifyingAt?: string | null;
  attributed_at: string;
  code: string;
  flags: ReferralFlag[];
  rewardLamports: string | number;
};

export type ProductOverview = {
  users?: number;
  activeBots?: number;
  discordBots?: number;
  kolBots?: number;
  pendingKolStrategies?: number;
  pendingPayouts?: number;
  openPositions?: number;
  unreconciledExecutions?: number;
  failedExecutions24h?: number;
  queuedJobs?: number;
  deadLetters?: number;
  pendingOutbox?: number;
  workers?: WorkerStatus[];
  systemFlags?: Record<string, unknown>;
};

export type Summary = {
  commissionSol?: number | string;
  tradeCount?: number;
  pendingApplications?: number;
  pendingChannels?: number;
  approvedChannels?: number;
  feeWalletConfigured?: boolean;
};

export type WorkerStatus = {
  key: string;
  instanceId?: string;
  executionMode?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
  healthy?: boolean;
};

export type KolStrategy = {
  id: string;
  slug: string;
  ownerPrivyUserId: string;
  botId: string;
  name: string;
  description?: string;
  botStatus: string;
  visibility: string;
  moderationStatus: string;
  creatorFeeBps: number;
  riskTier: string;
  version?: number;
  config?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Payout = {
  id: string;
  ownerPrivyUserId: string;
  asset: string;
  chain: string;
  destinationWallet: string;
  grossLamports: string | number;
  processingFeeLamports: string | number;
  netLamports: string | number;
  status: string;
  requested_at: string;
  reviewed_at?: string;
  processed_at?: string;
  txSignature?: string;
  decisionReason?: string;
};

export type AppUser = {
  privyUserId: string;
  displayName?: string;
  status: string;
  roles: string[];
  identities: Array<{ provider: string; email?: string; emailVerified: boolean }>;
  wallets: Array<{ address: string; label?: string; status: string }>;
  botCount: number;
  created_at: string;
};

export type Execution = {
  id: string;
  ownerPrivyUserId: string;
  botId?: string;
  mint: string;
  side: string;
  kind: string;
  intentState: string;
  executionMode: string;
  status: string;
  attempt: number;
  txSignature?: string;
  grossNotionalLamports: string | number;
  platformFeeLamports: string | number;
  creatorFeeLamports: string | number;
  errorCode?: string;
  errorMessage?: string;
  created_at: string;
};

export type ScannerHealth = {
  ok?: boolean;
  status?: string;
  latestSlot?: number;
  slotLag?: number;
  providers?: Array<Record<string, unknown>>;
  tokenCount?: number;
  poolCount?: number;
  unsupportedPools?: number;
  latestMarketSnapshotAt?: string;
  latestRiskSnapshotAt?: string;
  quarantinedSignals24h?: number;
};

export type SystemFlag = {
  flag_key: string;
  value: unknown;
  description?: string;
  updated_by?: string;
  updated_at?: string;
};

export type AuditEvent = {
  id: string;
  actorPrivyUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  correlationId?: string;
  created_at: string;
};

export type AdminData = {
  summary: Summary;
  product: ProductOverview;
  applications: Application[];
  channels: Channel[];
  strategies: KolStrategy[];
  referrals: ReferralAttribution[];
  payouts: Payout[];
  users: AppUser[];
  executions: Execution[];
  scanner: ScannerHealth;
  flags: SystemFlag[];
  events: AuditEvent[];
  discordOwnership: {
    sources: Array<{
      sourceGroupId: string;
      sourceName: string;
      discordGuildId: string;
      ownerPrivyUserId: string | null;
      discordUserId: string | null;
      commissionRateBps: number;
      verificationStatus: string;
      validFrom: string | null;
    }>;
    sessions: Array<Record<string, any>>;
    events: Array<Record<string, any>>;
  };
  botConfig: {
    clientId?: string;
    slashCommandConfigured?: boolean;
    registrationCommand?: string;
    registrationBridgeConfigured?: boolean;
    botBuild?: string;
    live?: {
      online?: boolean;
      serviceStatus?: string;
      version?: string | null;
      guilds?: number | null;
      commandsRegistered?: boolean;
      commandLastSuccessAt?: string | null;
      approvedChannelRefreshOk?: boolean;
      approvedChannels?: number | null;
      registrationAttempts?: number | null;
      registrationSucceeded?: number | null;
      registrationFailed?: number | null;
      lastRegistrationAt?: string | null;
    };
  };
};

export type AdminAction = {
  title: string;
  description: string;
  endpoint: string;
  method?: "POST" | "PATCH";
  body: Record<string, unknown>;
  destructive?: boolean;
  reasonRequired?: boolean;
};
