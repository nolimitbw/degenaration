import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { ensureUser } from "@/lib/server/user";
import { db } from "@/lib/db/client";
import { validateRules } from "@/lib/trading/rules";
import { validateLimits } from "@/lib/trading/caps";
import type { TakeProfitLevel } from "@/lib/trading/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionRow = {
  id: string;
  channel_id: string;
  per_trade_sol: string;
  max_daily_sol: string;
  take_profits: TakeProfitLevel[] | null;
  stop_loss_pct: string | null;
  slippage_bps: number;
  paused: boolean;
  channels: { title: string | null; username: string | null } | { title: string | null; username: string | null }[] | null;
};

const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

const shape = (row: SubscriptionRow) => {
  const channel = one(row.channels);
  return {
    id: row.id,
    channelId: row.channel_id,
    channelTitle: channel?.title ?? null,
    channelUsername: channel?.username ?? null,
    perTradeSol: Number(row.per_trade_sol),
    maxDailySol: Number(row.max_daily_sol),
    takeProfits: Array.isArray(row.take_profits) ? row.take_profits : [],
    stopLossPct: row.stop_loss_pct === null ? null : Number(row.stop_loss_pct),
    slippageBps: row.slippage_bps,
    paused: row.paused
  };
};

const SELECT =
  "id,channel_id,per_trade_sol,max_daily_sol,take_profits,stop_loss_pct,slippage_bps,paused,channels(title,username)";

export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const user = await ensureUser({ tgId: auth.user.id, username: auth.user.username, firstName: auth.user.firstName });
  if (!user) return NextResponse.json({ error: "could not load account" }, { status: 503 });

  const rows = await db<SubscriptionRow[]>(`subscriptions?user_id=eq.${user.id}&select=${SELECT}&order=created_at.desc`);
  if (!rows) return NextResponse.json({ error: "subscriptions unavailable" }, { status: 503 });

  return NextResponse.json({ subscriptions: rows.map(shape) });
}

/**
 * Create or update a subscription — the entire configuration step: pick a channel, set
 * per-trade size, a daily ceiling, a take-profit ladder, and a stop.
 *
 * Rules and limits are validated here rather than clamped. A ladder that sells 120% of
 * the position is a mistake worth reporting, not one to quietly reinterpret.
 */
export async function POST(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  let body: {
    channelId?: string;
    perTradeSol?: unknown;
    maxDailySol?: unknown;
    takeProfits?: { gainPct: number; sellPct: number }[];
    stopLossPct?: number | null;
    slippageBps?: number;
    paused?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (typeof body.channelId !== "string" || body.channelId.length === 0) {
    return NextResponse.json({ error: "Pick a channel first." }, { status: 400 });
  }

  const limits = validateLimits({ perTradeSol: body.perTradeSol, maxDailySol: body.maxDailySol });
  if (!limits.ok) return NextResponse.json({ error: limits.error }, { status: 400 });

  const rules = validateRules({ takeProfits: body.takeProfits, stopLossPct: body.stopLossPct ?? null });
  if (!rules.ok) return NextResponse.json({ error: rules.error }, { status: 400 });

  const slippageBps = Number(body.slippageBps ?? 300);
  if (!Number.isFinite(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    return NextResponse.json({ error: "Slippage must be between 0.01% and 50%." }, { status: 400 });
  }

  const user = await ensureUser({ tgId: auth.user.id, username: auth.user.username, firstName: auth.user.firstName });
  if (!user) return NextResponse.json({ error: "could not load account" }, { status: 503 });

  // Only approved channels can be followed. Without this check a user could subscribe to
  // a channel that is merely pending, and start copying a source nobody reviewed.
  const channel = await db<{ id: string }[]>(
    `channels?id=eq.${encodeURIComponent(body.channelId)}&status=eq.approved&select=id&limit=1`
  );
  if (!channel?.length) return NextResponse.json({ error: "That channel is not available to copy." }, { status: 400 });

  // A wallet must exist before a subscription can fire, or the first call silently skips.
  const wallet = await db<{ id: string }[]>(`wallets?user_id=eq.${user.id}&select=id&limit=1`);
  if (!wallet?.length) return NextResponse.json({ error: "Open the app once to create your wallet first." }, { status: 400 });

  const rows = await db<SubscriptionRow[]>("subscriptions?on_conflict=user_id,channel_id", {
    method: "POST",
    body: {
      user_id: user.id,
      channel_id: body.channelId,
      per_trade_sol: limits.limits.perTradeSol,
      max_daily_sol: limits.limits.maxDailySol,
      take_profits: rules.rules.takeProfits,
      stop_loss_pct: rules.rules.stopLossPct,
      slippage_bps: slippageBps,
      paused: body.paused === true,
      updated_at: new Date().toISOString()
    },
    prefer: `return=representation,resolution=merge-duplicates`
  });

  if (!rows?.length) return NextResponse.json({ error: "Could not save. Try again." }, { status: 503 });
  return NextResponse.json({ subscription: shape(rows[0]!) });
}

/** Stop copying a channel. Open positions are untouched and keep their exit rules. */
export async function DELETE(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing subscription id." }, { status: 400 });

  const user = await ensureUser({ tgId: auth.user.id, username: auth.user.username, firstName: auth.user.firstName });
  if (!user) return NextResponse.json({ error: "could not load account" }, { status: 503 });

  // Scoped to this user's own rows, so an id from another account deletes nothing.
  await db(`subscriptions?id=eq.${encodeURIComponent(id)}&user_id=eq.${user.id}`, {
    method: "DELETE",
    prefer: "return=minimal"
  });

  return NextResponse.json({ ok: true });
}
