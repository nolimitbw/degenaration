import { db } from "../lib/db/client.ts";
import { createWallet, loadKeypair } from "../lib/solana/wallet.ts";
import { getSolBalance, getPriceUsd } from "../lib/trading/jupiter.ts";
import { buyToken, sellToken } from "../lib/trading/execute.ts";
import { gainPercent } from "../lib/trading/rules.ts";
import { evaluateSpend, spendDay } from "../lib/trading/caps.ts";

/**
 * Manual trading from the chat: wallet, positions, buy, sell.
 *
 * These are the same execution primitives the copy engine uses. What differs is that a
 * manual trade is the user acting deliberately, so it is not bound by a subscription's
 * per-trade size — but it IS still bound by their daily ceiling, because that limit
 * exists to cap a bad day, not to cap automation specifically.
 */

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Manual buys have no subscription to inherit a daily cap from. */
const MANUAL_DAILY_CEILING_SOL = 100;
const DEFAULT_SLIPPAGE_BPS = 300;

async function userIdFor(tgId: string): Promise<string | null> {
  const rows = await db<{ id: string }[]>(`users?tg_id=eq.${encodeURIComponent(tgId)}&select=id&limit=1`);
  return rows?.[0]?.id ?? null;
}

export async function getWalletFor(tgId: string) {
  const userId = await userIdFor(tgId);
  if (!userId) return null;

  let rows = await db<{ address: string }[]>(`wallets?user_id=eq.${userId}&select=address&limit=1`);
  if (!rows?.length) {
    const wallet = createWallet();
    rows = await db<{ address: string }[]>("wallets", {
      method: "POST",
      body: { user_id: userId, address: wallet.address, encrypted_secret: wallet.encrypted.ciphertext }
    });
    if (!rows?.length) rows = await db<{ address: string }[]>(`wallets?user_id=eq.${userId}&select=address&limit=1`);
  }

  const address = rows?.[0]?.address;
  if (!address) return null;
  return { address, balanceSol: await getSolBalance(address) };
}

type PositionRow = {
  id: string;
  mint: string;
  symbol: string | null;
  amount_sol: string;
  entry_price_usd: string | null;
  tokens_bought: string;
  tokens_remaining: string;
};

export async function listPositionsFor(tgId: string) {
  const userId = await userIdFor(tgId);
  if (!userId) return [];

  const rows = await db<PositionRow[]>(
    `positions?user_id=eq.${userId}&status=eq.open&select=id,mint,symbol,amount_sol,entry_price_usd,tokens_bought,tokens_remaining&order=opened_at.desc&limit=20`
  );
  if (!rows?.length) return [];

  const prices = new Map<string, number | null>();
  for (const mint of new Set(rows.map((row) => row.mint))) {
    prices.set(mint, await getPriceUsd(mint));
  }

  return rows.map((row) => {
    const entry = row.entry_price_usd === null ? null : num(row.entry_price_usd) || null;
    const current = prices.get(row.mint) ?? null;
    const bought = num(row.tokens_bought);
    return {
      id: row.id,
      symbol: row.symbol,
      mint: row.mint,
      amountSol: num(row.amount_sol),
      changePct: entry && current ? gainPercent(entry, current) : null,
      remainingPct: bought > 0 ? (num(row.tokens_remaining) / bought) * 100 : 0
    };
  });
}

export async function manualBuyFor(input: { tgId: string; mint: string; amountSol: number }) {
  const userId = await userIdFor(input.tgId);
  if (!userId) return { ok: false, message: "Open the app once to set up your account first." };

  const walletRows = await db<{ address: string; encrypted_secret: string }[]>(
    `wallets?user_id=eq.${userId}&select=address,encrypted_secret&limit=1`
  );
  const wallet = walletRows?.[0];
  if (!wallet) return { ok: false, message: "No wallet yet. Open the app once to create one." };

  const day = spendDay(new Date());
  const spentRows = await db<{ amount_sol: string }[]>(
    `daily_spend?user_id=eq.${userId}&day=eq.${day}&select=amount_sol`
  );
  const spentToday = (spentRows ?? []).reduce((total, row) => total + num(row.amount_sol), 0);
  const balance = await getSolBalance(wallet.address);

  const decision = evaluateSpend({
    limits: { perTradeSol: input.amountSol, maxDailySol: MANUAL_DAILY_CEILING_SOL },
    spentTodaySol: spentToday,
    walletBalanceSol: balance ?? 0
  });
  if (!decision.allowed) return { ok: false, message: decision.reason };

  // Reserved before the trade, refunded if it fails — same ordering as the copy engine,
  // for the same reason: over-count a day rather than under-count it.
  await db("daily_spend", {
    method: "POST",
    body: { user_id: userId, day, amount_sol: decision.amountSol },
    prefer: "return=minimal"
  });

  const result = await buyToken({
    mint: input.mint,
    amountSol: decision.amountSol,
    slippageBps: DEFAULT_SLIPPAGE_BPS,
    encryptedSecret: wallet.encrypted_secret
  });

  if (!result.ok) {
    await db("daily_spend", {
      method: "POST",
      body: { user_id: userId, day, amount_sol: -decision.amountSol },
      prefer: "return=minimal"
    });
    return { ok: false, message: `Could not buy: ${result.error}` };
  }

  // A manual buy has no subscription and no call behind it, so it is recorded without
  // exit rules — nothing sells it automatically, which is what "manual" should mean.
  await db("positions", {
    method: "POST",
    body: {
      user_id: userId,
      subscription_id: null,
      call_id: null,
      mint: input.mint,
      amount_sol: decision.amountSol,
      tokens_bought: result.tokensOut,
      tokens_remaining: result.tokensOut,
      entry_price_usd: result.entryPriceUsd,
      entry_signature: result.signature,
      take_profits: [],
      stop_loss_pct: null,
      status: "open"
    },
    prefer: "return=minimal"
  });

  return {
    ok: true,
    message: `Bought ${decision.amountSol} SOL of <code>${input.mint.slice(0, 8)}…</code>.\nNo take-profit or stop-loss is set on a manual buy — use /positions to sell.`
  };
}

export async function manualSellFor(input: { tgId: string; positionId: string; fraction: number }) {
  const userId = await userIdFor(input.tgId);
  if (!userId) return { ok: false, message: "Account not found." };

  // Scoped to this user's own positions, so someone else's id sells nothing.
  const rows = await db<(PositionRow & { slippage_bps: number; wallets: { encrypted_secret: string } | { encrypted_secret: string }[] | null })[]>(
    `positions?id=eq.${encodeURIComponent(input.positionId)}&user_id=eq.${userId}&status=eq.open` +
      `&select=id,mint,symbol,amount_sol,entry_price_usd,tokens_bought,tokens_remaining,slippage_bps,wallets!inner(encrypted_secret)&limit=1`
  );
  const position = rows?.[0];
  if (!position) return { ok: false, message: "Position not found, or already closed." };

  const walletRel = position.wallets;
  const wallet = Array.isArray(walletRel) ? walletRel[0] : walletRel;
  if (!wallet?.encrypted_secret) return { ok: false, message: "Wallet unavailable for this position." };

  const bought = num(position.tokens_bought);
  const remaining = num(position.tokens_remaining);
  if (bought <= 0 || remaining <= 0) return { ok: false, message: "Nothing left to sell." };
  const remainingFraction = Math.max(0, Math.min(1, remaining / bought));

  // The user means "this share of what I still hold", which is not the same as the
  // fraction-of-original the exit engine works in.
  const fractionOfOriginal = Math.min(remainingFraction, input.fraction * remainingFraction);

  const result = await sellToken({
    mint: position.mint,
    tokensRemaining: position.tokens_remaining,
    remainingFraction,
    fractionOfOriginal,
    slippageBps: position.slippage_bps ?? DEFAULT_SLIPPAGE_BPS,
    encryptedSecret: wallet.encrypted_secret
  });
  if (!result.ok) return { ok: false, message: `Could not sell: ${result.error}` };

  const soldTokens = bought * fractionOfOriginal;
  const left = Math.max(0, remaining - soldTokens);

  await db("position_exits", {
    method: "POST",
    body: {
      position_id: position.id,
      kind: "manual",
      fraction: fractionOfOriginal,
      sol_out: result.solOut,
      signature: result.signature
    },
    prefer: "return=minimal"
  });

  await db(`positions?id=eq.${encodeURIComponent(position.id)}`, {
    method: "PATCH",
    body: {
      tokens_remaining: left,
      ...(left / bought <= 0.005 ? { status: "closed", closed_at: new Date().toISOString() } : {})
    },
    prefer: "return=minimal"
  });

  const label = position.symbol ?? `${position.mint.slice(0, 4)}…`;
  return { ok: true, message: `Sold ${(input.fraction * 100).toFixed(0)}% of ${label} for ${result.solOut.toFixed(4)} SOL.` };
}
