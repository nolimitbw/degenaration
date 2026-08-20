import { db } from "../lib/db/client.ts";
import { sendMessage } from "../lib/telegram/api.ts";
import { loadKeypair } from "../lib/solana/wallet.ts";
import { getSolBalance, getPriceUsd } from "../lib/trading/jupiter.ts";
import { buyToken, sellToken } from "../lib/trading/execute.ts";
import type { CopyDeps, Subscriber } from "./copy.ts";
import type { MonitorDeps, OpenPosition } from "./monitor.ts";
import type { ScannerDeps } from "./scanner.ts";
import { splitFee, platformFeeBps } from "../lib/trading/fees.ts";
import type { ExitRules, TakeProfitLevel } from "../lib/trading/rules.ts";

/**
 * Live implementations of the copy engine's and monitor's side effects.
 *
 * Everything that touches the chain funnels through here. When TRADING_MODE is not
 * "live", swaps are simulated against real quotes: the route, the price, and the size
 * are genuine, only the submission is skipped. That makes the whole path exercisable
 * end to end without moving funds.
 */

type SubscriptionRow = {
  id: string;
  user_id: string;
  per_trade_sol: string | number;
  max_daily_sol: string | number;
  take_profits: TakeProfitLevel[] | null;
  stop_loss_pct: string | number | null;
  slippage_bps: number;
  paused: boolean;
  wallets: { address: string; encrypted_secret: string } | { address: string; encrypted_secret: string }[] | null;
};

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** PostgREST returns an embedded to-one relation as an object or a single-element array. */
const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

function rulesFrom(row: { take_profits: TakeProfitLevel[] | null; stop_loss_pct: string | number | null }): ExitRules {
  return {
    takeProfits: Array.isArray(row.take_profits) ? row.take_profits : [],
    stopLossPct: row.stop_loss_pct === null ? null : num(row.stop_loss_pct, 0) || null
  };
}

async function notify(userId: string, message: string) {
  const rows = await db<{ tg_id: string }[]>(`users?id=eq.${encodeURIComponent(userId)}&select=tg_id&limit=1`);
  const tgId = rows?.[0]?.tg_id;
  if (!tgId) return;
  return sendMessage(tgId, message);
}

async function buy(input: { subscriber: Subscriber; mint: string; amountSol: number }) {
  return buyToken({
    mint: input.mint,
    amountSol: input.amountSol,
    slippageBps: input.subscriber.slippageBps,
    encryptedSecret: input.subscriber.encryptedSecret
  });
}

export function createCopyDeps(): CopyDeps {
  return {
    async getSubscribers(channelId) {
      const rows = await db<SubscriptionRow[]>(
        `subscriptions?channel_id=eq.${encodeURIComponent(channelId)}&paused=eq.false` +
          `&select=id,user_id,per_trade_sol,max_daily_sol,take_profits,stop_loss_pct,slippage_bps,paused,wallets(address,encrypted_secret)`
      );
      if (!rows) return [];

      return rows.flatMap<Subscriber>((row) => {
        const wallet = one(row.wallets);
        // No wallet means nothing to sign with. Skipped silently here rather than
        // failing the whole fan-out for everyone else on the channel.
        if (!wallet?.address || !wallet.encrypted_secret) return [];
        return [
          {
            subscriptionId: row.id,
            userId: row.user_id,
            walletAddress: wallet.address,
            encryptedSecret: wallet.encrypted_secret,
            limits: { perTradeSol: num(row.per_trade_sol), maxDailySol: num(row.max_daily_sol) },
            rules: rulesFrom(row),
            slippageBps: row.slippage_bps ?? 300,
            paused: row.paused
          }
        ];
      });
    },

    async getSpentToday(userId, day) {
      const rows = await db<{ amount_sol: string }[]>(
        `daily_spend?user_id=eq.${encodeURIComponent(userId)}&day=eq.${day}&select=amount_sol`
      );
      return (rows ?? []).reduce((total, row) => total + num(row.amount_sol), 0);
    },

    getWalletBalance: (address) => getSolBalance(address),

    buy,

    async openPosition(input) {
      const rows = await db<{ id: string }[]>("positions", {
        method: "POST",
        body: {
          user_id: input.userId,
          subscription_id: input.subscriptionId,
          call_id: input.callId,
          mint: input.mint,
          amount_sol: input.amountSol,
          tokens_bought: input.tokensOut,
          tokens_remaining: input.tokensOut,
          entry_price_usd: input.entryPriceUsd,
          entry_signature: input.signature,
          take_profits: input.rules.takeProfits,
          stop_loss_pct: input.rules.stopLossPct,
          status: "open"
        }
      });
      const created = rows?.[0] ?? null;
      if (created) {
        await accrueFee({
          positionId: created.id,
          userId: input.userId,
          channelId: input.channelId,
          kind: "entry",
          tradeSol: input.amountSol
        });
      }
      return created;
    },

    recordSpend: (input) =>
      db("daily_spend", {
        method: "POST",
        body: { user_id: input.userId, day: input.day, amount_sol: input.amountSol },
        prefer: "return=minimal"
      }),

    notify,

    async alreadyCopied(subscriptionId, callId) {
      const rows = await db<{ id: string }[]>(
        `positions?subscription_id=eq.${encodeURIComponent(subscriptionId)}&call_id=eq.${encodeURIComponent(callId)}&select=id&limit=1`
      );
      return Boolean(rows?.length);
    },

    now: () => new Date()
  };
}

type PositionRow = {
  id: string;
  user_id: string;
  mint: string;
  symbol: string | null;
  entry_price_usd: string | null;
  tokens_bought: string;
  tokens_remaining: string;
  take_profits: TakeProfitLevel[] | null;
  stop_loss_pct: string | null;
  slippage_bps: number;
  wallets: { address: string; encrypted_secret: string } | { address: string; encrypted_secret: string }[] | null;
};

export function createMonitorDeps(): MonitorDeps {
  return {
    async getOpenPositions(limit) {
      const rows = await db<PositionRow[]>(
        `positions?status=eq.open&select=id,user_id,mint,symbol,entry_price_usd,tokens_bought,tokens_remaining,take_profits,stop_loss_pct,slippage_bps,wallets!inner(address,encrypted_secret)&order=opened_at.asc&limit=${limit}`
      );
      if (!rows) return [];

      return rows.flatMap<OpenPosition>((row) => {
        const wallet = one(row.wallets);
        if (!wallet) return [];
        const bought = num(row.tokens_bought);
        const remaining = num(row.tokens_remaining);
        if (bought <= 0) return [];
        return [
          {
            id: row.id,
            userId: row.user_id,
            mint: row.mint,
            symbol: row.symbol,
            entryPriceUsd: row.entry_price_usd === null ? null : num(row.entry_price_usd) || null,
            remainingFraction: Math.max(0, Math.min(1, remaining / bought)),
            tokensRemaining: row.tokens_remaining,
            rules: rulesFrom({ take_profits: row.take_profits, stop_loss_pct: row.stop_loss_pct }),
            slippageBps: row.slippage_bps ?? 300,
            walletAddress: wallet.address,
            encryptedSecret: wallet.encrypted_secret
          }
        ];
      });
    },

    getPriceUsd,

    sell: (input) =>
      sellToken({
        mint: input.position.mint,
        tokensRemaining: input.position.tokensRemaining,
        remainingFraction: input.position.remainingFraction,
        fractionOfOriginal: input.fractionOfOriginal,
        slippageBps: input.position.slippageBps,
        encryptedSecret: input.position.encryptedSecret
      }),

    async recordExit(input) {
      await db("position_exits", {
        method: "POST",
        body: {
          position_id: input.positionId,
          kind: input.kind,
          level_index: input.levelIndex,
          fraction: input.fractionOfOriginal,
          sol_out: input.solOut,
          price_usd: input.priceUsd,
          signature: input.signature
        },
        prefer: "return=minimal"
      });

      // Mark the level hit and draw down the remaining tokens. Read-modify-write is safe
      // here because the monitor is the only writer of these columns and runs one tick
      // at a time.
      const rows = await db<{ tokens_bought: string; tokens_remaining: string; take_profits: TakeProfitLevel[] | null; realized_sol: string }[]>(
        `positions?id=eq.${encodeURIComponent(input.positionId)}&select=tokens_bought,tokens_remaining,take_profits,realized_sol&limit=1`
      );
      const row = rows?.[0];
      if (!row) return;

      const levels = Array.isArray(row.take_profits) ? [...row.take_profits] : [];
      if (input.levelIndex !== null && levels[input.levelIndex]) {
        levels[input.levelIndex] = { ...levels[input.levelIndex]!, hit: true };
      }

      const sold = num(row.tokens_bought) * input.fractionOfOriginal;
      const remaining = Math.max(0, num(row.tokens_remaining) - sold);

      await db(`positions?id=eq.${encodeURIComponent(input.positionId)}`, {
        method: "PATCH",
        body: {
          tokens_remaining: remaining,
          take_profits: levels,
          realized_sol: num(row.realized_sol) + input.solOut
        },
        prefer: "return=minimal"
      });
    },

    closePosition: (positionId) =>
      db(`positions?id=eq.${encodeURIComponent(positionId)}`, {
        method: "PATCH",
        body: { status: "closed", closed_at: new Date().toISOString() },
        prefer: "return=minimal"
      }),

    notify
  };
}

type ScanRow = {
  id: string;
  channel_id: string;
  mint: string;
  called_price_usd: string | null;
  peak_price_usd: string | null;
};

export function createScannerDeps(): ScannerDeps {
  return {
    async getCallsToScan(limit) {
      // Newest first: a fresh call's price is what subscribers are watching right now,
      // and an old one's peak rarely moves.
      const rows = await db<ScanRow[]>(
        `calls?select=id,channel_id,mint,called_price_usd,peak_price_usd&order=called_at.desc&limit=${limit}`
      );
      return (rows ?? []).map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        mint: row.mint,
        calledPriceUsd: row.called_price_usd === null ? null : num(row.called_price_usd) || null,
        peakPriceUsd: row.peak_price_usd === null ? null : num(row.peak_price_usd) || null
      }));
    },

    getPriceUsd,

    updateCallPrices: (input) =>
      db(`calls?id=eq.${encodeURIComponent(input.callId)}`, {
        method: "PATCH",
        body: {
          latest_price_usd: input.latestPriceUsd,
          peak_price_usd: input.peakPriceUsd,
          last_scanned_at: new Date().toISOString()
        },
        prefer: "return=minimal"
      }),

    async getChannelCalls(channelId) {
      const rows = await db<{ called_price_usd: string | null; peak_price_usd: string | null }[]>(
        `calls?channel_id=eq.${encodeURIComponent(channelId)}&select=called_price_usd,peak_price_usd&limit=1000`
      );
      return (rows ?? []).map((row) => ({
        calledPriceUsd: row.called_price_usd === null ? null : num(row.called_price_usd) || null,
        peakPriceUsd: row.peak_price_usd === null ? null : num(row.peak_price_usd) || null
      }));
    },

    updateChannelStats: (channelId, stats) =>
      db(`channels?id=eq.${encodeURIComponent(channelId)}`, {
        method: "PATCH",
        body: {
          calls_measured: stats.callsMeasured,
          wins: stats.wins,
          avg_peak_x: stats.avgPeakX,
          median_peak_x: stats.medianPeakX,
          best_peak_x: stats.bestPeakX,
          stats_updated_at: new Date().toISOString()
        },
        prefer: "return=minimal"
      })
  };
}

/**
 * Record what a trade earned.
 *
 * Accrual only — nothing is transferred here. Fees become a payable balance the moment a
 * trade happens, and paying them out is a separate, deliberate step. Recording is
 * best-effort: a ledger write must never be the reason a user's trade fails.
 */
export async function accrueFee(input: {
  positionId: string | null;
  userId: string;
  channelId: string | null;
  kind: "entry" | "exit";
  tradeSol: number;
}) {
  try {
    const split = splitFee({ amountSol: input.tradeSol, hasChannel: input.channelId !== null });
    if (split.totalFeeSol <= 0) return;

    await db("fee_accruals", {
      method: "POST",
      body: {
        position_id: input.positionId,
        user_id: input.userId,
        channel_id: input.channelId,
        kind: input.kind,
        trade_sol: input.tradeSol,
        fee_bps: platformFeeBps(),
        total_fee_sol: split.totalFeeSol,
        channel_sol: split.channelSol,
        platform_sol: split.platformSol
      },
      prefer: "return=minimal"
    });
  } catch {
    // Intentionally swallowed; see above.
  }
}
