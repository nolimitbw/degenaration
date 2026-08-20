import { db } from "../lib/db/client.ts";
import { sendMessage } from "../lib/telegram/api.ts";
import { loadKeypair } from "../lib/solana/wallet.ts";
import { getQuote, executeSwap, getSolBalance, getPriceUsd, connection, WSOL_MINT, LAMPORTS, isLiveTrading } from "../lib/trading/jupiter.ts";
import type { CopyDeps, Subscriber } from "./copy.ts";
import type { MonitorDeps, OpenPosition } from "./monitor.ts";
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

/**
 * Buy `amountSol` of `mint`, then mark the entry price.
 *
 * The entry price is read from the quote actually filled rather than from a separate
 * price lookup, so take-profit and stop-loss are measured against what the user really
 * paid — including slippage — instead of an idealised mid price they never got.
 */
async function buy(input: { subscriber: Subscriber; mint: string; amountSol: number }) {
  const lamports = BigInt(Math.floor(input.amountSol * LAMPORTS));
  const quote = await getQuote({
    inputMint: WSOL_MINT,
    outputMint: input.mint,
    amount: lamports,
    slippageBps: input.subscriber.slippageBps
  });
  if (!quote) return { ok: false as const, error: "no route for this token" };

  const tokensOut = Number(quote.outAmount);
  if (!Number.isFinite(tokensOut) || tokensOut <= 0) return { ok: false as const, error: "route returned nothing" };

  const solPrice = await getPriceUsd(WSOL_MINT);
  // Price per token in USD, derived from the fill: (SOL in x SOL price) / tokens out.
  const entryPriceUsd = solPrice ? (input.amountSol * solPrice) / tokensOut : null;

  if (!isLiveTrading()) {
    return {
      ok: true as const,
      signature: `simulated:${Date.now()}`,
      tokensOut: quote.outAmount,
      entryPriceUsd
    };
  }

  const signer = loadKeypair(input.subscriber.encryptedSecret);
  // A wallet we cannot decrypt is a hard stop, never a retry: the ciphertext is wrong
  // or the master key changed, and neither is fixed by trying again.
  if (!signer) return { ok: false as const, error: "wallet key unavailable" };

  const result = await executeSwap({ quote, signer });
  if (!result.ok) return { ok: false as const, error: result.error };

  return { ok: true as const, signature: result.signature, tokensOut: result.outAmount, entryPriceUsd };
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
      return rows?.[0] ?? null;
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

    async sell(input) {
      const tokens = num(input.position.tokensRemaining);
      // Sell a slice of the ORIGINAL position, expressed against what is left now.
      const originalRemaining = input.position.remainingFraction;
      if (originalRemaining <= 0 || tokens <= 0) return { ok: false as const, error: "nothing left to sell" };
      const shareOfHolding = Math.min(1, input.fractionOfOriginal / originalRemaining);
      const amount = BigInt(Math.floor(tokens * shareOfHolding));
      if (amount <= 0n) return { ok: false as const, error: "sell amount rounds to zero" };

      const quote = await getQuote({
        inputMint: input.position.mint,
        outputMint: WSOL_MINT,
        amount,
        slippageBps: input.position.slippageBps
      });
      if (!quote) return { ok: false as const, error: "no exit route" };

      const solOut = Number(quote.outAmount) / LAMPORTS;

      if (!isLiveTrading()) {
        return { ok: true as const, signature: `simulated:${Date.now()}`, solOut };
      }

      const signer = loadKeypair(input.position.encryptedSecret);
      if (!signer) return { ok: false as const, error: "wallet key unavailable" };

      const result = await executeSwap({ quote, signer, conn: connection() });
      if (!result.ok) return { ok: false as const, error: result.error };
      return { ok: true as const, signature: result.signature, solOut };
    },

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
