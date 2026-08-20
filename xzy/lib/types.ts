/** Shapes shared between the Mini App's API routes and its components. */

export type Me = { id: string; username: string | null; firstName: string | null; isAdmin: boolean };

export type ChannelRow = {
  id: string;
  title: string | null;
  username: string | null;
  memberCount: number | null;
  /** All null until the scanner has measured this channel. Never render as zero. */
  callsMeasured?: number;
  winRatePct?: number | null;
  medianPeakX?: number | null;
  avgPeakX?: number | null;
  bestPeakX?: number | null;
};

export type AdminChannel = {
  id: string;
  chatId: string;
  title: string | null;
  username: string | null;
  status: string;
  memberCount: number | null;
  listedByTgId: string | null;
  listedAt: string;
  approvedAt: string | null;
};

export type TakeProfit = { gainPct: number; sellPct: number; hit?: boolean };

export type Subscription = {
  id: string;
  channelId: string;
  channelTitle: string | null;
  channelUsername: string | null;
  perTradeSol: number;
  maxDailySol: number;
  takeProfits: TakeProfit[];
  stopLossPct: number | null;
  slippageBps: number;
  paused: boolean;
};

export type Wallet = { address: string; balanceSol: number | null; live: boolean };

export type Position = {
  id: string;
  mint: string;
  symbol: string | null;
  status: string;
  amountSol: number;
  realizedSol: number;
  entryPriceUsd: number | null;
  currentPriceUsd: number | null;
  /** Null when unpriced — an unknown position must never render as flat. */
  changePct: number | null;
  remainingPct: number;
  openedAt: string;
};
