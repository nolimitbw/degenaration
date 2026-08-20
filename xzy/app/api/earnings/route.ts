import { NextResponse } from "next/server";
import { authenticate } from "@/lib/server/auth";
import { ensureUser } from "@/lib/server/user";
import { db } from "@/lib/db/client";
import { feesArePayable, platformFeeBps } from "@/lib/trading/fees";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a channel owner has earned from calls their channel made.
 *
 * Summed from the append-only accrual ledger rather than read from a running total, so a
 * missed write shows up as a smaller number rather than a silently wrong one.
 */
export async function GET(req: Request) {
  const auth = authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });

  const user = await ensureUser({ tgId: auth.user.id, username: auth.user.username, firstName: auth.user.firstName });
  if (!user) return NextResponse.json({ error: "could not load account" }, { status: 503 });

  // Channels this person listed, identified by the numeric Telegram ID that promoted the
  // bot — the same ownership proof used at listing time.
  const channels = await db<{ id: string; title: string | null }[]>(
    `channels?listed_by_tg_id=eq.${encodeURIComponent(auth.user.id)}&select=id,title`
  );
  if (!channels?.length) {
    return NextResponse.json({ channels: [], totalSol: 0, unpaidSol: 0, payable: feesArePayable() });
  }

  const ids = channels.map((channel) => channel.id).join(",");
  const accruals = await db<{ channel_id: string; channel_sol: string; paid_out: boolean }[]>(
    `fee_accruals?channel_id=in.(${ids})&select=channel_id,channel_sol,paid_out&limit=5000`
  );

  const byChannel = new Map<string, { total: number; unpaid: number }>();
  for (const row of accruals ?? []) {
    const amount = Number(row.channel_sol);
    if (!Number.isFinite(amount)) continue;
    const entry = byChannel.get(row.channel_id) ?? { total: 0, unpaid: 0 };
    entry.total += amount;
    if (!row.paid_out) entry.unpaid += amount;
    byChannel.set(row.channel_id, entry);
  }

  const rows = channels.map((channel) => {
    const entry = byChannel.get(channel.id) ?? { total: 0, unpaid: 0 };
    return { id: channel.id, title: channel.title, earnedSol: entry.total, unpaidSol: entry.unpaid };
  });

  return NextResponse.json({
    channels: rows,
    totalSol: rows.reduce((sum, row) => sum + row.earnedSol, 0),
    unpaidSol: rows.reduce((sum, row) => sum + row.unpaidSol, 0),
    feeBps: platformFeeBps(),
    // Until a destination account is configured, fees accrue but cannot be sent. Saying
    // so is better than showing a balance that quietly never arrives.
    payable: feesArePayable()
  });
}
